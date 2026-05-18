from django.db import models
from django.utils import timezone
from django.contrib.auth.models import AbstractUser, Group
import uuid
from datetime import timedelta


class Tariff(models.Model):
    """Справочник тарифов для занятий"""
    TYPE_CHOICES = [
        ('group', 'Групповое занятие'),
        ('individual', 'Индивидуальное занятие'),
        ('split', 'Сплит (до 2 человек)'),
    ]
    
    name = models.CharField("Название тарифа", max_length=100)
    tariff_type = models.CharField("Тип тарифа", max_length=20, choices=TYPE_CHOICES, default='group')
    price_per_person = models.DecimalField("Цена за одного человека", max_digits=10, decimal_places=2)
    price_full_split = models.DecimalField("Полная цена за сплит (если пришел 1 из 2)", 
                                           max_digits=10, decimal_places=2, default=0,
                                           help_text="Заполняется только для тарифа 'Сплит'")
    max_participants = models.PositiveIntegerField("Макс. участников", default=10)
    description = models.TextField("Описание", blank=True)
    is_active = models.BooleanField("Активен", default=True)
    created_at = models.DateTimeField("Дата создания", auto_now_add=True)
    
    # Поля для абонемента
    is_subscription_available = models.BooleanField("Доступен абонемент", default=False,
                                                    help_text="Если отмечено, для этого тарифа можно приобрести абонемент")
    subscription_sessions_count = models.PositiveIntegerField("Количество занятий в абонементе", 
                                                              default=8,
                                                              help_text="Стандартное количество занятий в абонементе")
    subscription_price = models.DecimalField("Стоимость абонемента", max_digits=10, decimal_places=2, 
                                             default=0,
                                             help_text="Общая стоимость абонемента")
    subscription_validity_days = models.PositiveIntegerField("Срок действия абонемента (дней)", 
                                                             default=45,
                                                             help_text="Срок действия абонемента в днях (по умолчанию 45 дней = 1.5 месяца)")

    class Meta:
        verbose_name = "Тариф"
        verbose_name_plural = "Тарифы"
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.get_tariff_type_display()}) - {self.price_per_person} руб."
    
    def save(self, *args, **kwargs):
        # Автоматически устанавливаем цену полного сплита, если не задана
        if self.tariff_type == 'split' and self.price_full_split == 0:
            self.price_full_split = self.price_per_person * 2
        # Автоматически рассчитываем стоимость абонемента, если не задана
        if self.is_subscription_available and self.subscription_price == 0:
            self.subscription_price = self.price_per_person * self.subscription_sessions_count
        super().save(*args, **kwargs)


class ClassType(models.Model):
    """Справочник типов занятий"""
    name = models.CharField("Название занятия", max_length=100)
    description = models.TextField("Описание", blank=True)
    duration_minutes = models.PositiveIntegerField("Стандартная длительность (мин)", default=60)
    default_tariff = models.ForeignKey(Tariff, on_delete=models.SET_NULL, null=True, blank=True, 
                                       verbose_name="Тариф по умолчанию",
                                       help_text="Тариф, применяемый по умолчанию для этого типа занятий")

    class Meta:
        verbose_name = "Тип занятия"
        verbose_name_plural = "Типы занятий"
        ordering = ['name']

    def __str__(self):
        return self.name


class User(AbstractUser):
    """Модель пользователя (клиента/ученика) с расширенными полями"""
    ROLE_CHOICES = [
        ('student', 'Ученик'),
        ('moderator', 'Модератор'),
        ('admin', 'Администратор'),
    ]
    phone = models.CharField("Телефон", max_length=20, blank=True)
    role = models.CharField("Роль", max_length=20, choices=ROLE_CHOICES, default='student')
    created_at = models.DateTimeField("Дата регистрации", auto_now_add=True)
    is_active = models.BooleanField("Активен", default=True)
    balance = models.DecimalField("Баланс", max_digits=10, decimal_places=2, default=0)
    telegram_id = models.BigIntegerField("Telegram ID", null=True, blank=True, unique=True, 
                                             help_text="Уникальный идентификатор пользователя в Telegram")
    vk_id = models.BigIntegerField("VK ID", null=True, blank=True, unique=True, 
                                       help_text="Уникальный идентификатор пользователя ВКонтакте")
    allowed_tariffs = models.ManyToManyField(Tariff, blank=True, 
                                             verbose_name="Доступные тарифы",
                                             help_text="Тарифы, которые доступны пользователю для записи")

    class Meta:
        verbose_name = "Клиент"
        verbose_name_plural = "Клиенты"
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.last_name} {self.first_name}"
    
    @property
    def is_moderator(self):
        return self.role in ['moderator', 'admin']
    
    @property
    def is_admin(self):
        return self.role == 'admin'


class UserDefaultSettings(models.Model):
    """Настройки по умолчанию для новых пользователей"""
    default_tariffs = models.ManyToManyField(Tariff, blank=True, 
                                             verbose_name="Тарифы по умолчанию",
                                             help_text="Тарифы, которые будут автоматически назначаться новым пользователям")
    default_groups = models.ManyToManyField(Group, blank=True, 
                                            verbose_name="Группы по умолчанию",
                                            help_text="Группы прав доступа, которые будут автоматически назначаться новым пользователям")
    default_role = models.CharField("Роль по умолчанию", max_length=20, choices=User.ROLE_CHOICES, default='student')
    default_balance = models.DecimalField("Баланс по умолчанию", max_digits=10, decimal_places=2, default=0)
    
    class Meta:
        verbose_name = "Настройки новых пользователей"
        verbose_name_plural = "Настройки новых пользователей"
    
    def __str__(self):
        return "Настройки по умолчанию для новых пользователей"
    
    @classmethod
    def get_defaults(cls):
        """Получить текущие настройки по умолчанию (первый объект или создать)"""
        obj, created = cls.objects.get_or_create(pk=1)
        return obj


class Hall(models.Model):
    """Модель зала для аренды"""
    COLOR_CHOICES = [
        ('#FF6B6B', 'Красный'),
        ('#4ECDC4', 'Бирюзовый'),
        ('#45B7D1', 'Голубой'),
        ('#96CEB4', 'Зеленый'),
        ('#FFEAA7', 'Желтый'),
        ('#DDA0DD', 'Фиолетовый'),
        ('#FFA07A', 'Оранжевый'),
        ('#98D8C8', 'Мятный'),
        ('#F7DC6F', 'Лимонный'),
        ('#BB8FCE', 'Лавандовый'),
    ]
    name = models.CharField("Название зала", max_length=100)
    address = models.TextField("Адрес", blank=True)
    price_per_hour = models.DecimalField("Цена за час", max_digits=10, decimal_places=2, default=0)
    color = models.CharField("Цвет события", max_length=7, choices=COLOR_CHOICES, default='#4ECDC4')

    class Meta:
        verbose_name = "Зал"
        verbose_name_plural = "Залы"

    def __str__(self):
        return self.name


class ClassSession(models.Model):
    """Модель занятия"""
    class_type = models.ForeignKey(ClassType, on_delete=models.CASCADE, verbose_name="Занятие")
    tariff = models.ForeignKey(Tariff, on_delete=models.PROTECT, verbose_name="Тариф",
                               help_text="Тариф для этого занятия")
    date_time = models.DateTimeField("Дата и время")
    duration = models.PositiveIntegerField("Длительность (мин)", default=60)
    hall = models.ForeignKey(Hall, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Зал")
    is_recurring = models.BooleanField("Повторять каждую неделю", default=False)
    recurrence_id = models.CharField("ID серии повторений", max_length=50, blank=True, db_index=True)

    class Meta:
        verbose_name = "Занятие"
        verbose_name_plural = "Занятия"
        ordering = ['-date_time']

    def __str__(self):
        return f"{self.class_type.name} - {self.date_time.strftime('%d.%m.%Y %H:%M')} ({self.tariff.name})"

    def save(self, *args, **kwargs):
        # Автоматически устанавливаем длительность из типа занятия, если не указана явно
        if not self.duration and self.class_type:
            self.duration = self.class_type.duration_minutes
        # Если is_recurring=True, но recurrence_id не задан, генерируем его
        if self.is_recurring and not self.recurrence_id:
            self.recurrence_id = str(uuid.uuid4())
        super().save(*args, **kwargs)
    
    def get_current_price(self):
        """Расчет текущей цены для записи с учетом заполненности (для сплита)"""
        if self.tariff.tariff_type != 'split':
            return self.tariff.price_per_person
        
        # Для сплита считаем количество записанных
        bookings_count = self.bookings.filter(status__in=['confirmed', 'paid']).count()
        
        if bookings_count >= 2:
            # Если записано 2 человека, цена делится поровну
            return self.tariff.price_per_person
        else:
            # Если записан 1 человек, он платит полную стоимость за сплит
            return self.tariff.price_full_split


class Booking(models.Model):
    """Модель записи пользователя на занятие"""
    STATUS_CHOICES = [
        ('pending', 'Ожидает подтверждения'),
        ('confirmed', 'Подтверждено'),
        ('paid', 'Оплачено'),
        ('cancelled', 'Отменено пользователем'),
        ('cancelled_by_admin', 'Отменено администратором'),
        ('no_show', 'Не пришел'),
    ]
    
    session = models.ForeignKey(ClassSession, on_delete=models.CASCADE, related_name='bookings', 
                                verbose_name="Занятие")
    client = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="Клиент")
    status = models.CharField("Статус", max_length=20, choices=STATUS_CHOICES, default='pending')
    booked_at = models.DateTimeField("Дата записи", auto_now_add=True)
    payment_deadline = models.DateTimeField("Дедлайн оплаты", null=True, blank=True,
                                            help_text="Время, до которого нужно оплатить (за 4 часа до занятия)")
    paid_at = models.DateTimeField("Дата оплаты", null=True, blank=True)
    amount_paid = models.DecimalField("Сумма оплаты", max_digits=10, decimal_places=2, default=0)
    comment = models.TextField("Комментарий", blank=True)
    
    # Поля для абонемента
    is_subscription_used = models.BooleanField("Использован абонемент", default=False,
                                               help_text="Если отмечено, занятие оплачено через абонемент")
    subscription = models.ForeignKey('Subscription', on_delete=models.SET_NULL, null=True, blank=True,
                                     verbose_name="Абонемент", related_name='bookings',
                                     help_text="Абонемент, через который оплачено занятие")

    class Meta:
        verbose_name = "Запись на занятие"
        verbose_name_plural = "Записи на занятия"
        unique_together = ['session', 'client']
        ordering = ['-booked_at']

    def __str__(self):
        return f"{self.client} -> {self.session} ({self.get_status_display()})"
    
    def save(self, *args, **kwargs):
        # Автоматически устанавливаем дедлайн оплаты (за 4 часа до занятия)
        if not self.payment_deadline and self.session:
            self.payment_deadline = self.session.date_time - timedelta(hours=4)
        super().save(*args, **kwargs)


class PaymentTransaction(models.Model):
    """Детализированная история всех финансовых операций"""
    TRANSACTION_TYPES = [
        ('deposit', 'Пополнение баланса'),
        ('debit', 'Списание за занятие'),
        ('refund', 'Возврат средств'),
        ('adjustment', 'Корректировка баланса'),
        ('subscription_purchase', 'Покупка абонемента'),
        ('subscription_use', 'Использование абонемента'),
    ]
    
    client = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transactions', 
                               verbose_name="Клиент")
    transaction_type = models.CharField("Тип операции", max_length=25, choices=TRANSACTION_TYPES)
    amount = models.DecimalField("Сумма", max_digits=10, decimal_places=2)
    balance_before = models.DecimalField("Баланс до операции", max_digits=10, decimal_places=2)
    balance_after = models.DecimalField("Баланс после операции", max_digits=10, decimal_places=2)
    booking = models.ForeignKey(Booking, on_delete=models.SET_NULL, null=True, blank=True, 
                                verbose_name="Запись", related_name='transactions')
    subscription = models.ForeignKey('Subscription', on_delete=models.SET_NULL, null=True, blank=True,
                                     verbose_name="Абонемент", related_name='transactions',
                                     help_text="Абонемент, связанный с этой операцией")
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField("Дата создания", auto_now_add=True)

    class Meta:
        verbose_name = "Финансовая операция"
        verbose_name_plural = "Финансовые операции"
        ordering = ['-created_at']

    def __str__(self):
        sign = '+' if self.transaction_type == 'deposit' else '-'
        return f"{self.client}: {sign}{self.amount} руб. ({self.get_transaction_type_display()})"


class Subscription(models.Model):
    """Модель абонемента на занятия"""
    STATUS_CHOICES = [
        ('active', 'Активен'),
        ('expired', 'Истек'),
        ('used_up', 'Использован полностью'),
        ('cancelled', 'Отменен'),
    ]
    
    client = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="Клиент",
                               related_name='subscriptions')
    tariff = models.ForeignKey(Tariff, on_delete=models.PROTECT, verbose_name="Тариф",
                               help_text="Тариф, для которого приобретен абонемент")
    sessions_total = models.PositiveIntegerField("Всего занятий", default=8)
    sessions_remaining = models.PositiveIntegerField("Осталось занятий")
    purchased_at = models.DateTimeField("Дата покупки", auto_now_add=True)
    activated_at = models.DateTimeField("Дата активации", null=True, blank=True,
                                        help_text="Дата первого использования абонемента")
    expires_at = models.DateTimeField("Дата истечения", null=True, blank=True)
    status = models.CharField("Статус", max_length=20, choices=STATUS_CHOICES, default='active')
    total_price = models.DecimalField("Общая стоимость", max_digits=10, decimal_places=2)
    comment = models.TextField("Комментарий", blank=True)

    class Meta:
        verbose_name = "Абонемент"
        verbose_name_plural = "Абонементы"
        ordering = ['-purchased_at']

    def __str__(self):
        return f"{self.client} - {self.tariff.name} ({self.sessions_remaining}/{self.sessions_total})"
    
    def save(self, *args, **kwargs):
        # При создании устанавливаем sessions_remaining равным sessions_total
        if not self.sessions_remaining and self.sessions_total:
            self.sessions_remaining = self.sessions_total
        # Если абонемент активирован и дата истечения не задана, рассчитываем её
        if self.activated_at and not self.expires_at:
            validity_days = self.tariff.subscription_validity_days if self.tariff else 45
            self.expires_at = self.activated_at + timedelta(days=validity_days)
        super().save(*args, **kwargs)
    
    def activate(self):
        """Активировать абонемент (при первой записи)"""
        if not self.activated_at:
            self.activated_at = timezone.now()
            validity_days = self.tariff.subscription_validity_days if self.tariff else 45
            self.expires_at = self.activated_at + timedelta(days=validity_days)
            self.save()
    
    def use_session(self):
        """Использовать одно занятие из абонемента"""
        if self.sessions_remaining > 0:
            self.sessions_remaining -= 1
            if not self.activated_at:
                self.activate()
            if self.sessions_remaining == 0:
                self.status = 'used_up'
            elif self.expires_at and timezone.now() > self.expires_at:
                self.status = 'expired'
            self.save()
    
    def is_valid(self):
        """Проверить, действителен ли абонемент"""
        if self.status != 'active':
            return False
        if self.sessions_remaining <= 0:
            self.status = 'used_up'
            self.save()
            return False
        if self.expires_at and timezone.now() > self.expires_at:
            self.status = 'expired'
            self.save()
            return False
        return True


class Attendance(models.Model):
    """Модель посещаемости (для статистики после занятия)"""
    session = models.ForeignKey(ClassSession, on_delete=models.CASCADE, verbose_name="Занятие")
    client = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="Клиент")
    visited_at = models.DateTimeField("Дата посещения", auto_now_add=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=[
            ('attended', 'Посетил'),
            ('cancelled', 'Отменил'),
            ('no_show', 'Не пришел'),
        ],
        default='attended'
    )

    class Meta:
        verbose_name = "Посещение"
        verbose_name_plural = "Посещения"
        unique_together = ['session', 'client']

    def __str__(self):
        return f"{self.client} - {self.session}"


class Payment(models.Model):
    """Модель оплаты занятий клиентами (для прямого пополнения баланса)"""
    PAYMENT_TYPES = [
        ('single', 'Разовое занятие'),
        ('subscription', 'Абонемент'),
        ('package', 'Пакет занятий'),
    ]

    STATUS_CHOICES = [
        ('paid', 'Оплачено'),
        ('pending', 'Ожидает оплаты'),
        ('refunded', 'Возвращено'),
    ]

    client = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="Клиент")
    amount = models.DecimalField("Сумма", max_digits=10, decimal_places=2)
    payment_type = models.CharField("Тип оплаты", max_length=20, choices=PAYMENT_TYPES, default='single')
    status = models.CharField("Статус", max_length=20, choices=STATUS_CHOICES, default='paid')
    paid_at = models.DateTimeField("Дата оплаты", default=timezone.now)
    sessions_count = models.PositiveIntegerField("Количество занятий", default=1)
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField("Дата создания", auto_now_add=True)

    class Meta:
        verbose_name = "Оплата"
        verbose_name_plural = "Оплаты"
        ordering = ['-paid_at']

    def __str__(self):
        return f"{self.client} - {self.amount} руб."


class RentPayment(models.Model):
    """Модель оплаты аренды залов"""
    STATUS_CHOICES = [
        ('paid', 'Оплачено'),
        ('pending', 'Ожидает оплаты'),
        ('overdue', 'Просрочено'),
    ]

    hall = models.ForeignKey(Hall, on_delete=models.CASCADE, verbose_name="Зал")
    amount = models.DecimalField("Сумма", max_digits=10, decimal_places=2)
    rent_date = models.DateField("Дата аренды")
    hours_rented = models.DecimalField("Часов аренды", max_digits=5, decimal_places=1, default=1)
    status = models.CharField("Статус", max_length=20, choices=STATUS_CHOICES, default='pending')
    paid_at = models.DateTimeField("Дата оплаты", null=True, blank=True)
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField("Дата создания", auto_now_add=True)

    class Meta:
        verbose_name = "Оплата аренды"
        verbose_name_plural = "Оплаты аренды"
        ordering = ['-rent_date']

    def __str__(self):
        return f"{self.hall} - {self.rent_date} - {self.amount} руб."


class GroupPermissionsSyncHandler:
    """
    Обработчик для синхронизации прав пользователей при изменении прав группы.
    При изменении прав группы, все пользователи этой группы получают обновленные права.
    """
    
    @staticmethod
    def sync_group_permissions(sender, instance, action, pk_set, **kwargs):
        """
        Сигнал для синхронизации прав всех пользователей группы при изменении прав группы.
        """
        if action == 'post_add':
            # Права добавлены в группу - добавляем их всем пользователям группы
            if pk_set:
                from django.contrib.auth.models import Permission
                permissions = Permission.objects.filter(pk__in=pk_set)
                # Получаем всех пользователей этой группы
                users = instance.user_set.all()
                for user in users:
                    user.user_permissions.add(*permissions)
        
        elif action == 'post_remove':
            # Права удалены из группы - удаляем их у всех пользователей группы
            # (только если эти права не принадлежат другим группам пользователя)
            if pk_set:
                from django.contrib.auth.models import Permission
                permissions_to_remove = Permission.objects.filter(pk__in=pk_set)
                users = instance.user_set.all()
                
                for user in users:
                    # Проверяем, есть ли у пользователя эти права от других групп
                    for perm in permissions_to_remove:
                        # Получаем все группы пользователя
                        user_groups = user.groups.all()
                        # Проверяем, есть ли это право в других группах
                        has_permission_from_other_group = False
                        for group in user_groups:
                            if group != instance and perm in group.permissions.all():
                                has_permission_from_other_group = True
                                break
                        
                        # Если право есть только в этой группе, удаляем его у пользователя
                        if not has_permission_from_other_group:
                            user.user_permissions.remove(perm)
    
    @classmethod
    def connect(cls):
        """Подключить обработчик к сигналу m2m_changed для модели Group"""
        from django.db.models.signals import m2m_changed
        from django.contrib.auth.models import Group
        
        m2m_changed.connect(
            cls.sync_group_permissions,
            sender=Group.permissions.through
        )
