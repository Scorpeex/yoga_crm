from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import get_user_model
import re

User = get_user_model()


class RegistrationForm(UserCreationForm):
    """Форма регистрации нового пользователя"""
    first_name = forms.CharField(
        label="Имя",
        required=True,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Введите ваше имя'
        })
    )
    last_name = forms.CharField(
        label="Фамилия",
        required=True,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Введите вашу фамилию'
        })
    )
    phone = forms.CharField(
        label="Телефон",
        required=True,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': '+7 (___) ___-__-__',
            'id': 'id_phone',
            'autocomplete': 'tel'
        }),
        help_text="Введите номер телефона в формате +7XXXXXXXXXX"
    )

    class Meta:
        model = User
        fields = ('first_name', 'last_name', 'phone', 'password1', 'password2')
        widgets = {
            'password1': forms.PasswordInput(attrs={
                'class': 'form-control',
                'placeholder': 'Пароль',
                'autocomplete': 'new-password'
            }),
            'password2': forms.PasswordInput(attrs={
                'class': 'form-control',
                'placeholder': 'Подтвердите пароль',
                'autocomplete': 'new-password'
            }),
            'phone': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': '+7 (___) ___-__-__',
                'id': 'id_phone',
                'autocomplete': 'tel'
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['password1'].label = "Пароль"
        self.fields['password2'].label = "Подтверждение пароля"
    
    def clean_phone(self):
        """Очистка и валидация номера телефона"""
        phone = self.cleaned_data.get('phone')
        if not phone:
            raise forms.ValidationError("Номер телефона обязателен")
        
        # Удаляем все нецифровые символы кроме +
        cleaned_phone = re.sub(r'[^\d+]', '', phone)
        
        # Если номер начинается с 8, заменяем на +7
        if cleaned_phone.startswith('8') and len(cleaned_phone) == 11:
            cleaned_phone = '+7' + cleaned_phone[1:]
        
        # Проверяем формат +7XXXXXXXXXX (12 символов: +7 + 10 цифр)
        if not re.match(r'^\+7\d{10}$', cleaned_phone):
            raise forms.ValidationError("Неверный формат телефона. Используйте формат +7XXXXXXXXXX")
        
        # Проверяем уникальность телефона
        existing_users = User.objects.filter(username=cleaned_phone)
        if existing_users.exists():
            raise forms.ValidationError("Пользователь с таким номером телефона уже зарегистрирован")
        
        return cleaned_phone


class LoginForm(AuthenticationForm):
    """Форма входа для существующих пользователей"""
    username = forms.CharField(
        label="Телефон",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': '+7 (___) ___-__-__',
            'id': 'id_username',
            'autocomplete': 'tel'
        })
    )
    password = forms.CharField(
        label="Пароль",
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Введите пароль',
            'autocomplete': 'current-password'
        })
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'].label = ""
        self.fields['password'].label = ""
    
    def clean_username(self):
        """Очистка номера телефона от форматирования"""
        phone = self.cleaned_data.get('username')
        if not phone:
            raise forms.ValidationError("Номер телефона обязателен")
        
        # Удаляем все нецифровые символы кроме +
        cleaned_phone = re.sub(r'[^\d+]', '', phone)
        
        # Если номер начинается с 8, заменяем на +7
        if cleaned_phone.startswith('8') and len(cleaned_phone) == 11:
            cleaned_phone = '+7' + cleaned_phone[1:]
        
        # Проверяем формат +7XXXXXXXXXX (12 символов: +7 + 10 цифр)
        if not re.match(r'^\+7\d{10}$', cleaned_phone):
            raise forms.ValidationError("Неверный формат телефона. Используйте формат +7XXXXXXXXXX")
        
        return cleaned_phone
