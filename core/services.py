"""
Сервис для обработки платежей и списания средств за занятия
Теперь списание происходит мгновенно при записи на занятие
"""

from django.utils import timezone
from datetime import timedelta
from decimal import Decimal
from core.models import Booking, PaymentTransaction, ClassSession, Subscription


class PaymentService:
    """Сервис для управления платежами и списаниями"""
    
    @staticmethod
    def charge_booking_immediately(booking, session):
        """
        Мгновенное списание средств за запись на занятие
        Сначала пытается использовать абонемент, затем списывает с баланса
        """
        client = booking.client
        amount = session.get_current_price()
        
        # Проверяем, есть ли действующий абонемент для этого тарифа
        active_subscription = Subscription.objects.filter(
            client=client,
            tariff=session.tariff,
            status='active'
        ).first()
        
        if active_subscription and active_subscription.is_valid():
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
        
        # Проверяем, что тариф абонемента соответствует тарифу занятия
        if subscription.tariff != booking.session.tariff:
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
        """
        if booking.status == 'paid':
            # Если уже оплачена - делаем возврат
            return PaymentService.refund_booking(
                booking, 
                reason="Отменено администратором" if by_admin else "Отменено пользователем"
            )
        
        # Просто меняем статус
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
    def get_available_sessions_for_user(user):
        """
        Получение списка занятий, доступных для записи пользователю
        с учетом его тарифов
        """
        # Получаем тарифы пользователя
        user_tariffs = user.allowed_tariffs.all()
        
        if not user_tariffs.exists():
            return ClassSession.objects.none()
        
        # Фильтруем занятия по тарифам пользователя
        available_sessions = ClassSession.objects.filter(
            tariff__in=user_tariffs,
            date_time__gt=timezone.now()
        ).order_by('date_time')
        
        return available_sessions
    
    @staticmethod
    def can_book_session(user, session):
        """
        Проверка возможности записи пользователя на занятие
        """
        # Проверяем тариф
        if session.tariff not in user.allowed_tariffs.all():
            return False, "У вас нет доступа к этому тарифу"
        
        # Проверяем, не записан ли уже пользователь
        existing_booking = Booking.objects.filter(
            session=session,
            client=user
        ).first()
        
        if existing_booking:
            return False, "Вы уже записаны на это занятие"
        
        # Для сплита проверяем заполненность
        if session.tariff.tariff_type == 'split':
            booked_count = session.bookings.filter(
                status__in=['confirmed', 'paid']
            ).count()
            
            if booked_count >= 2:
                return False, "Группа полностью заполнена"
        
        # Проверяем, есть ли действующий абонемент для этого тарифа
        active_subscription = Subscription.objects.filter(
            client=user,
            tariff=session.tariff,
            status='active'
        ).first()
        
        if active_subscription and active_subscription.is_valid():
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
        Создание записи на занятие с мгновенным списанием средств
        Сначала пытается использовать абонемент, затем списывает с баланса
        """
        # Проверяем возможность записи
        can_book, message = PaymentService.can_book_session(user, session)
        
        if not can_book:
            raise ValueError(message)
        
        # Создаем запись со статусом 'confirmed' (временный статус до оплаты)
        booking = Booking.objects.create(
            session=session,
            client=user,
            status='confirmed',
            comment=comment,
            amount_paid=session.get_current_price()
        )
        
        # Мгновенно списываем средства или используем абонемент
        try:
            PaymentService.charge_booking_immediately(booking, session)
        except Exception as e:
            # Если не удалось списать средства - удаляем запись и выбрасываем ошибку
            booking.delete()
            raise ValueError(str(e))
        
        return booking
