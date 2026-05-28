"""
Сервис для обработки платежей и списания средств за занятия
"""

from django.utils import timezone
from datetime import timedelta
from decimal import Decimal
from core.models import Booking, PaymentTransaction, ClassSession, Subscription


class PaymentService:
    """Сервис для управления платежами и списаниями"""
    
    @staticmethod
    def process_payment_deadlines():
        """
        Обработка дедлайнов оплаты - списание средств за 3 часа 50 минут до занятия
        Вызывается периодически (например, через cron или celery beat)
        """
        now = timezone.now()
        
        # Находим все подтвержденные записи, у которых наступил дедлайн оплаты
        # и которые еще не оплачены
        bookings_to_charge = Booking.objects.filter(
            status='confirmed',
            payment_deadline__lte=now,
            paid_at__isnull=True,
            is_subscription_used=False  # Исключаем записи, оплаченные абонементом
        ).select_related('session', 'client', 'session__tariff')
        
        charged_count = 0
        failed_count = 0
        
        for booking in bookings_to_charge:
            try:
                PaymentService.charge_booking(booking)
                charged_count += 1
            except Exception as e:
                print(f"Ошибка списания для записи {booking.id}: {e}")
                failed_count += 1
                # Помечаем запись как проблемную
                booking.status = 'pending'
                booking.save()
        
        return {
            'charged': charged_count,
            'failed': failed_count,
            'total': bookings_to_charge.count()
        }
    
    @staticmethod
    def charge_booking(booking):
        """
        Списание средств за конкретную запись
        """
        client = booking.client
        session = booking.session
        amount = session.get_current_price()
        
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
    def create_booking(user, session, comment="", use_subscription=False):
        """
        Создание записи на занятие
        """
        # Проверяем возможность записи
        can_book, message = PaymentService.can_book_session(user, session)
        
        if not can_book:
            raise ValueError(message)
        
        # Создаем запись
        booking = Booking.objects.create(
            session=session,
            client=user,
            status='confirmed',  # Можно изменить на 'pending' если нужно подтверждение
            comment=comment,
            amount_paid=session.get_current_price()
        )
        
        # Если запрошено использование абонемента - используем его
        if use_subscription:
            active_subscription = Subscription.objects.filter(
                client=user,
                tariff=session.tariff,
                status='active'
            ).first()
            
            if active_subscription and active_subscription.is_valid():
                PaymentService.use_subscription_for_booking(booking, active_subscription)
        
        return booking
