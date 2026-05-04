from django.db import models
from django.utils import timezone


class ClassType(models.Model):
    """Справочник типов занятий"""
    name = models.CharField("Название занятия", max_length=100)
    description = models.TextField("Описание", blank=True)
    duration_minutes = models.PositiveIntegerField("Стандартная длительность (мин)", default=60)

    class Meta:
        verbose_name = "Тип занятия"
        verbose_name_plural = "Типы занятий"
        ordering = ['name']

    def __str__(self):
        return self.name


class Client(models.Model):
    """Модель клиента (ученика)"""
    first_name = models.CharField("Имя", max_length=100)
    last_name = models.CharField("Фамилия", max_length=100)
    phone = models.CharField("Телефон", max_length=20, blank=True)
    email = models.EmailField("Email", blank=True)
    created_at = models.DateTimeField("Дата регистрации", auto_now_add=True)
    is_active = models.BooleanField("Активен", default=True)

    class Meta:
        verbose_name = "Клиент"
        verbose_name_plural = "Клиенты"
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.last_name} {self.first_name}"


class Hall(models.Model):
    """Модель зала для аренды"""
    name = models.CharField("Название зала", max_length=100)
    address = models.TextField("Адрес", blank=True)
    price_per_hour = models.DecimalField("Цена за час", max_digits=10, decimal_places=2, default=0)

    class Meta:
        verbose_name = "Зал"
        verbose_name_plural = "Залы"

    def __str__(self):
        return self.name


class ClassSession(models.Model):
    """Модель занятия"""
    class_type = models.ForeignKey(ClassType, on_delete=models.CASCADE, verbose_name="Занятие")
    date_time = models.DateTimeField("Дата и время")
    duration = models.PositiveIntegerField("Длительность (мин)", default=60)
    hall = models.ForeignKey(Hall, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Зал")
    max_participants = models.PositiveIntegerField("Макс. участников", default=20)

    class Meta:
        verbose_name = "Занятие"
        verbose_name_plural = "Занятия"
        ordering = ['-date_time']

    def __str__(self):
        return f"{self.class_type.name} - {self.date_time.strftime('%d.%m.%Y %H:%M')}"

    def save(self, *args, **kwargs):
        # Автоматически устанавливаем длительность из типа занятия, если не указана явно
        if not self.duration and self.class_type:
            self.duration = self.class_type.duration_minutes
        super().save(*args, **kwargs)


class Attendance(models.Model):
    """Модель посещаемости"""
    session = models.ForeignKey(ClassSession, on_delete=models.CASCADE, verbose_name="Занятие")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, verbose_name="Клиент")
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
    """Модель оплаты занятий клиентами"""
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

    client = models.ForeignKey(Client, on_delete=models.CASCADE, verbose_name="Клиент")
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
