"""
Сервис для обработки платежей и списания средств за занятия
Теперь списание происходит мгновенно при записи на занятие
"""

from django.utils import timezone
from datetime import timedelta
from decimal import Decimal
from django.db.models import Q
from core.models import Booking, PaymentTransaction, ClassSession, Subscription, Tariff


class PaymentService:
    """Сервис для управления платежами и списаниями"""

    @staticmethod
    def effective_tariff_ids(tariff):
        """ID тарифов, совместимых с данным: сам тариф + все тарифы его группы.

        Тарифы одной группы (например «Мини-группа Lite» и «Мини-группа Pro»)
        считаются взаимозаменяемыми: доступ/абонемент любого из них открывает
        занятия всех тарифов группы. Тарифы без группы совместимы только сами с собой.
        """
        if tariff is None:
            return []
        ids = {tariff.id}
        if tariff.group_id:
            ids.update(tariff.group.tariff_set.values_list('id', flat=True))
        return list(ids)

    @staticmethod
    def tariffs_match(a, b):
        """Совпадают ли тарифы (или принадлежат одной группе)."""
        if a is None or b is None:
            return a is not None and b is not None and a.id == b.id
        if a.id == b.id:
            return True
        return bool(a.group_id and a.group_id == b.group_id)

    @staticmethod
    def session_tariff_allowed_for_user(user, session):
        """Есть ли у пользователя доступ к занятию с учётом групп тарифов."""
        effective = set(PaymentService.effective_tariff_ids(session.tariff))
        if not effective:
            return False
        allowed = set(user.allowed_tariffs.values_list('id', flat=True))
        return bool(effective & allowed)

    @staticmethod
    def session_access_q(user):
        """Q-условие «занятие доступно пользователю» с учётом групп тарифов."""
        allowed = list(user.allowed_tariffs.all())
        if not allowed:
            return Q(pk__in=[])
        allowed_ids = [t.id for t in allowed]
        q = Q(tariff_id__in=allowed_ids)
        group_ids = list(Tariff.objects.filter(id__in=allowed_ids, group_id__isnull=False).values_list('group_id', flat=True))
        if group_ids:
            q |= Q(tariff__group_id__in=group_ids)
        return q

    @staticmethod
    def get_matching_subscription(client, session):
        """Активный валидный абонемент, совместимый с тарифом занятия (с учётом групп).

        Возвращает None, если подходящего абонемента нет.
        """
        effective = set(PaymentService.effective_tariff_ids(session.tariff))
        if not effective:
            return None
        subscription = Subscription.objects.filter(
            client=client,
            tariff_id__in=effective,
            status='active',
            sessions_remaining__gt=0,
        ).select_related('tariff').order_by('expires_at', 'id').first()
        if subscription and subscription.is_valid():
            return subscription
        return None
    
    @staticmethod
    def charge_booking_immediately(booking, session):
        """
        Мгновенное списание средств за запись на занятие
        Сначала пытается использовать абонемент, затем списывает с баланса
        """
        client = booking.client
        amount = session.get_current_price()
        
        # Проверяем, есть ли действующий абонемент, совместимый с тарифом занятия (с учётом групп)
        active_subscription = PaymentService.get_matching_subscription(client, session)
        
        if active_subscription:
            # Используем абонемент
            return PaymentService.use_subscription_for_booking(booking, active_subscription)
        
        # Проверяем баланс
        if client.balance < amount:
            raise ValueError(f"Недостаточно средств на балансе. Требуется: {amount}, доступно: {client.balance}")
        
        # Сохраняем баланс до операции
        balance_before = client.balance
        
        # Списываем средства
        client.balance -= amount
        client.save()
        
        # Обновляем запись
        booking.amount_paid = amount
        booking.paid_at = timezone.now()
        booking.status = 'paid'
        booking.save()
        
        # Создаем транзакцию
        PaymentTransaction.objects.create(
            client=client,
            transaction_type='debit',
            amount=amount,
            balance_before=balance_before,
            balance_after=client.balance,
            booking=booking,
            comment=f"Оплата занятия: {session.class_type.name} на {session.date_time.strftime('%d.%m.%Y %H:%M')}"
        )
        
        return booking
    
    @staticmethod
    def use_subscription_for_booking(booking, subscription):
        """
        Использование абонемента для оплаты записи
        """
        if not subscription.is_valid():
            raise ValueError("Абонемент недействителен")
        
        # Проверяем, что тариф абонемента совместим с тарифом занятия (с учётом групп)
        if not PaymentService.tariffs_match(subscription.tariff, booking.session.tariff):
            raise ValueError("Тариф абонемента не соответствует тарифу занятия")
        
        # Сохраняем баланс до операции (для транзакции)
        balance_before = booking.client.balance
        
        # Используем занятие из абонемента
        subscription.use_session()
        
        # Обновляем запись
        booking.is_subscription_used = True
        booking.subscription = subscription
        booking.paid_at = timezone.now()
        booking.status = 'paid'
        booking.amount_paid = 0  # Так как оплачено абонементом
        booking.save()
        
        # Создаем транзакцию использования абонемента (информационную)
        PaymentTransaction.objects.create(
            client=booking.client,
            transaction_type='subscription_use',
            amount=booking.session.get_current_price(),
            balance_before=balance_before,
            balance_after=balance_before,  # Баланс не меняется
            booking=booking,
            subscription=subscription,
            comment=f"Использование абонемента: {subscription.tariff.name}. Осталось занятий: {subscription.sessions_remaining}"
        )
        
        return booking
    
    @staticmethod
    def refund_booking(booking, reason=""):
        """
        Возврат средств за отмененное занятие
        """
        if booking.status != 'paid' or not booking.paid_at:
            raise ValueError("Запись не оплачена")
        
        # Если было использовано абонемент - возвращаем занятие в абонемент
        if booking.is_subscription_used and booking.subscription:
            subscription = booking.subscription
            subscription.sessions_remaining += 1
            if subscription.status == 'used_up':
                subscription.status = 'active'
            subscription.save()
            
            booking.is_subscription_used = False
            booking.subscription = None
            booking.status = 'cancelled'
            booking.save()
            
            # Создаем транзакцию возврата абонемента
            PaymentTransaction.objects.create(
                client=booking.client,
                transaction_type='subscription_use',
                amount=booking.amount_paid,
                balance_before=booking.client.balance,
                balance_after=booking.client.balance,
                booking=booking,
                subscription=subscription,
                comment=f"Возврат занятия в абонемент: {reason}" if reason else "Возврат занятия в абонемент"
            )
            return booking
        
        client = booking.client
        amount = booking.amount_paid
        
        # Сохраняем баланс до операции
        balance_before = client.balance
        
        # Возвращаем средства
        client.balance += amount
        client.save()
        
        # Обновляем запись
        booking.status = 'cancelled'
        booking.save()
        
        # Создаем транзакцию возврата
        PaymentTransaction.objects.create(
            client=client,
            transaction_type='refund',
            amount=amount,
            balance_before=balance_before,
            balance_after=client.balance,
            booking=booking,
            comment=f"Возврат средств: {reason}" if reason else "Возврат средств за отмененное занятие"
        )
        
        return booking
    
    @staticmethod
    def cancel_booking(booking, by_admin=False):
        """
        Отмена записи (если еще не оплачена)
        Для сплита: confirmed → просто отмена, paid → возврат
        """
        if booking.status == 'paid':
            # Если уже оплачена - делаем возврат
            return PaymentService.refund_booking(
                booking, 
                reason="Отменено администратором" if by_admin else "Отменено пользователем"
            )
        
        # Сплит: запись без оплаты — просто меняем статус
        booking.status = 'cancelled_by_admin' if by_admin else 'cancelled'
        booking.save()
        
        return booking
    
    @staticmethod
    def deposit_balance(client, amount, comment=""):
        """
        Пополнение баланса клиента
        """
        if amount <= 0:
            raise ValueError("Сумма пополнения должна быть положительной")
        
        # Сохраняем баланс до операции
        balance_before = client.balance
        
        # Зачисляем средства
        client.balance += amount
        client.save()
        
        # Создаем транзакцию
        PaymentTransaction.objects.create(
            client=client,
            transaction_type='deposit',
            amount=amount,
            balance_before=balance_before,
            balance_after=client.balance,
            comment=comment or "Пополнение баланса"
        )
        
        return client
    
    @staticmethod
    def charge_split_bookings(booking):
        """
        Списание средств за сплит-занятие (вызывается по дедлайну).
        Цена = split_total_price / количество подтверждённых записей.
        """
        session = booking.session
        if session.tariff.tariff_type != 'split':
            raise ValueError("Не сплит-занятие")
        
        total_price = session.tariff.split_total_price
        
        # Активные записи на эту сессию (исключая отменённые)
        active_bookings = Booking.objects.filter(
            session=session,
            status__in=['confirmed', 'paid']
        ).select_related('client')
        
        active_count = active_bookings.count()
        if active_count == 0:
            raise ValueError("Нет активных записей на сплит-занятие")
        
        # Цена на одного человека
        from decimal import ROUND_HALF_UP
        price_per_person = (total_price / Decimal(active_count)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        
        # Списываем с каждого confirmed
        errors = []
        for b in active_bookings:
            if b.status == 'paid':
                continue  # уже оплачено
            
            client = b.client
            if client.balance < price_per_person:
                # Не хватает денег — отменяем запись
                b.status = 'cancelled'
                b.save()
                errors.append(f"{client.first_name} {client.last_name}: недостаточно средств")
                continue
            
            balance_before = client.balance
            client.balance -= price_per_person
            client.save()
            
            b.amount_paid = price_per_person
            b.paid_at = timezone.now()
            b.status = 'paid'
            b.save()
            
            PaymentTransaction.objects.create(
                client=client,
                transaction_type='debit',
                amount=price_per_person,
                balance_before=balance_before,
                balance_after=client.balance,
                booking=b,
                comment=f"Оплата сплит-занятия: {session.class_type.name}, цена за человека: {price_per_person} руб."
            )
        
        return errors
    
    @staticmethod
    def process_split_sessions():
        """
        Обработка всех сплит-сессий, у которых наступил дедлайн оплаты.
        Вызывается при запросе данных о занятиях.
        """
        now = timezone.now()
        sessions = ClassSession.objects.filter(
            tariff__tariff_type='split',
            date_time__gt=now,
            bookings__status='confirmed'
        ).distinct()
        
        results = []
        for session in sessions:
            # Проверяем, что дедлайн наступил (или скоро наступит)
            deadline = session.date_time - timedelta(hours=3, minutes=50)
            if now >= deadline:
                errors = PaymentService.charge_split_bookings(
                    session.bookings.filter(status='confirmed').first()
                )
                if errors:
                    results.append({'session_id': session.id, 'errors': errors})
        
        return results
    
    @staticmethod
    def purchase_subscription(client, tariff, comment=""):
        """
        Покупка абонемента для клиента
        """
        if not tariff.is_subscription_available:
            raise ValueError("Для этого тарифа недоступны абонементы")
        
        if client.balance < tariff.subscription_price:
            raise ValueError(f"Недостаточно средств. Стоимость абонемента: {tariff.subscription_price}")
        
        # Сохраняем баланс до операции
        balance_before = client.balance
        
        # Списываем стоимость абонемента
        client.balance -= tariff.subscription_price
        client.save()
        
        # Создаем абонемент
        subscription = Subscription.objects.create(
            client=client,
            tariff=tariff,
            sessions_total=tariff.subscription_sessions_count,
            total_price=tariff.subscription_price,
            comment=comment
        )
        
        # Создаем транзакцию покупки абонемента
        PaymentTransaction.objects.create(
            client=client,
            transaction_type='subscription_purchase',
            amount=tariff.subscription_price,
            balance_before=balance_before,
            balance_after=client.balance,
            subscription=subscription,
            comment=f"Покупка абонемента: {tariff.name} ({tariff.subscription_sessions_count} занятий)"
        )
        
        return subscription

    @staticmethod
    def can_renew_subscription(subscription):
        """Проверить, можно ли продлить абонемент"""
        if subscription.status != 'active':
            return False
        if not subscription.tariff.is_active:
            return False
        if not subscription.tariff.is_subscription_available:
            return False

        # Условие 1: осталось 1 или 0 занятий
        if subscription.sessions_remaining <= 1:
            return True

        # Условие 2: истекает раньше ближайшего доступного занятия для этого тарифа/группы
        if subscription.expires_at:
            now = timezone.now()
            if subscription.expires_at <= now:
                return True

            effective_ids = PaymentService.effective_tariff_ids(subscription.tariff)
            next_session = ClassSession.objects.filter(
                tariff_id__in=effective_ids,
                date_time__gt=now
            ).order_by('date_time').first()

            if next_session and subscription.expires_at < next_session.date_time:
                return True

        return False

    @staticmethod
    def renew_subscription(subscription, comment=""):
        """Продлить существующий абонемент: добавить занятия, продлить срок"""
        tariff = subscription.tariff
        client = subscription.client

        if not tariff.is_subscription_available:
            raise ValueError("Для этого тарифа недоступны абонементы")

        if not tariff.is_active:
            raise ValueError("Этот тариф больше неактивен")

        if subscription.status != 'active':
            raise ValueError("Абонемент неактивен, продление невозможно")

        if not PaymentService.can_renew_subscription(subscription):
            raise ValueError("Условия для продления не соблюдены")

        if client.balance < tariff.subscription_price:
            raise ValueError(f"Недостаточно средств. Стоимость: {tariff.subscription_price}")

        balance_before = client.balance
        client.balance -= tariff.subscription_price
        client.save()

        # Добавляем занятия к существующему абонементу
        subscription.sessions_total += tariff.subscription_sessions_count
        subscription.sessions_remaining += tariff.subscription_sessions_count
        subscription.total_price += tariff.subscription_price

        # Продлеваем срок: от max(текущий expires_at, now) + validity_days
        now = timezone.now()
        base = max(subscription.expires_at, now) if subscription.expires_at else now
        subscription.expires_at = base + timedelta(days=tariff.subscription_validity_days)

        if comment:
            subscription.comment = comment

        subscription.save()

        PaymentTransaction.objects.create(
            client=client,
            transaction_type='subscription_renewal',
            amount=tariff.subscription_price,
            balance_before=balance_before,
            balance_after=client.balance,
            subscription=subscription,
            comment=f"Продление абонемента: {tariff.name} (+{tariff.subscription_sessions_count} занятий)"
        )

        return subscription

    @staticmethod
    def get_available_sessions_for_user(user):
        """
        Получение списка занятий, доступных для записи пользователю
        с учетом его тарифов
        """
        # Получаем тарифы пользователя
        user_tariffs = user.allowed_tariffs.all()
        
        if not user_tariffs.exists():
            return ClassSession.objects.none()
        
        # Фильтруем занятия по тарифам пользователя (с учётом групп тарифов)
        available_sessions = ClassSession.objects.filter(
            PaymentService.session_access_q(user),
            date_time__gt=timezone.now()
        ).order_by('date_time')
        
        return available_sessions
    
    @staticmethod
    def can_book_session(user, session):
        """
        Проверка возможности записи пользователя на занятие
        """
        # Проверяем тариф (с учётом групп)
        if not PaymentService.session_tariff_allowed_for_user(user, session):
            return False, "У вас нет доступа к этому тарифу"
        
        # Проверяем, не записан ли уже пользователь (исключая отменённые)
        existing_booking = Booking.objects.filter(
            session=session,
            client=user
        ).exclude(
            status__in=['cancelled', 'cancelled_by_admin']
        ).first()
        
        if existing_booking:
            return False, "Вы уже записаны на это занятие"
        
        # Для сплита проверяем заполненность
        if session.tariff.tariff_type == 'split':
            booked_count = session.bookings.filter(
                status__in=['confirmed', 'paid']
            ).count()
            
            if booked_count >= session.get_max_participants():
                return False, "Группа полностью заполнена"
            
            # Для сплита не проверяем баланс — оплата по дедлайну
            return True, "OK"
        
        # Проверяем, есть ли действующий абонемент, совместимый с тарифом занятия (с учётом групп)
        active_subscription = PaymentService.get_matching_subscription(user, session)
        
        if active_subscription:
            # Если есть абонемент - разрешаем запись без проверки баланса
            return True, "OK"
        
        # Проверяем баланс (с учетом возможной полной стоимости для сплита)
        required_amount = session.get_current_price()
        if user.balance < required_amount:
            return False, f"Недостаточно средств. Требуется: {required_amount} руб."
        
        return True, "OK"
    
    @staticmethod
    def create_booking(user, session, comment=""):
        """
        Создание записи на занятие
        - Для обычных тарифов: мгновенное списание
        - Для сплита: запись без оплаты (списание по дедлайну)
        """
        # Проверяем возможность записи
        can_book, message = PaymentService.can_book_session(user, session)
        
        if not can_book:
            raise ValueError(message)
        
        is_split = session.tariff.tariff_type == 'split'
        
        # Создаем запись
        booking = Booking.objects.create(
            session=session,
            client=user,
            status='confirmed',
            comment=comment,
            amount_paid=0 if is_split else session.get_current_price()
        )
        
        if is_split:
            # Сплит: не списываем сразу, оплата по дедлайну
            return booking
        
        # Мгновенно списываем средства или используем абонемент
        try:
            PaymentService.charge_booking_immediately(booking, session)
        except Exception as e:
            booking.delete()
            raise ValueError(str(e))
        
        return booking
