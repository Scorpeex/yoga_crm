/**
 * Phone mask utility for input fields
 * Formats phone numbers as: +7 (XXX) XXX-XX-XX
 */

(function() {
    'use strict';

    // Минимальная длина префикса "+7 ("
    const MIN_LENGTH = 4; // "+7 ("

    // Маска для телефона: +7 (___) ___-__-__
    const formatPhone = (value) => {
        // Удаляем все нецифровые символы
        let digits = value.replace(/\D/g, '');

        // Если начинается с 8, заменяем на 7
        if (digits.startsWith('8')) {
            digits = '7' + digits.slice(1);
        } else if (digits.length > 0 && !digits.startsWith('7')) {
            // Если введена цифра не 7 или 8, добавляем 7 в начало
            digits = '7' + digits;
        }

        // Оставляем только первые 11 цифр (7 + 10 цифр номера)
        digits = digits.slice(0, 11);

        // Форматируем: +7 (XXX) XXX-XX-XX
        if (digits.length === 0) return '';
        if (digits.length === 1) return '+7';
        if (digits.length <= 4) return '+7 (' + digits.slice(1);
        if (digits.length <= 7) return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4);
        if (digits.length <= 9) return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
        if (digits.length <= 11) return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9);

        return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
    };

    // Получить позицию для вставки цифры (пропуская фиксированные символы)
    const getNextEditablePosition = (currentPos, value) => {
        // Позиции фиксированных символов: 0='+', 1='7', 2=' ', 3='('
        // Первый редактируемый символ - позиция 4
        if (currentPos < MIN_LENGTH) {
            return MIN_LENGTH;
        }
        return currentPos;
    };

    // Инициализация маски телефона для поля
    const initPhoneMask = (phoneInput) => {
        if (!phoneInput) return;

        // Обработчик ввода
        phoneInput.addEventListener('input', function(e) {
            const cursorPosition = this.selectionStart;
            const oldValue = e.target.dataset.prevValue || '';
            const newValue = this.value;

            // Сохраняем текущее значение для следующего сравнения
            e.target.dataset.prevValue = newValue;

            // Извлекаем только цифры из нового значения
            let digits = newValue.replace(/\D/g, '');

            // Если начинается с 8, заменяем на 7
            if (digits.startsWith('8')) {
                digits = '7' + digits.slice(1);
            } else if (digits.length > 0 && !digits.startsWith('7')) {
                digits = '7' + digits;
            }

            digits = digits.slice(0, 11);

            const formattedValue = formatPhone(digits);
            this.value = formattedValue;

            // Корректировка позиции курсора
            // Считаем, сколько цифр было введено до позиции курсора в старом значении
            let digitCountBeforeCursor = 0;
            for (let i = 0; i < Math.min(cursorPosition, oldValue.length); i++) {
                if (/\d/.test(oldValue[i])) {
                    digitCountBeforeCursor++;
                }
            }

            // Находим новую позицию курсора в отформатированном значении
            let newCursorPosition = MIN_LENGTH; // Начинаем после "+7 ("
            let currentDigitCount = 0;

            for (let i = MIN_LENGTH; i < formattedValue.length; i++) {
                if (currentDigitCount >= digitCountBeforeCursor) {
                    break;
                }
                if (/\d/.test(formattedValue[i])) {
                    currentDigitCount++;
                }
                newCursorPosition = i + 1;
            }

            // Если была добавлена новая цифра, продвигаем курсор ещё на 1
            if (newValue.length > oldValue.length && /\d/.test(newValue.slice(-1))) {
                newCursorPosition++;
            }

            // Не даём курсору уйти за пределы редактируемой части
            if (newCursorPosition < MIN_LENGTH) {
                newCursorPosition = MIN_LENGTH;
            }

            this.setSelectionRange(newCursorPosition, newCursorPosition);
        });

        // Обработчик перед вводом - сохраняем предыдущее значение
        phoneInput.addEventListener('beforeinput', function(e) {
            e.target.dataset.prevValue = this.value;
        });

        // Обработчик клика - не даём установить курсор в фиксированную часть
        phoneInput.addEventListener('click', function() {
            if (this.selectionStart < MIN_LENGTH) {
                this.setSelectionRange(MIN_LENGTH, MIN_LENGTH);
            }
        });

        // Обработчик фокуса - не даём установить курсор в фиксированную часть
        phoneInput.addEventListener('focus', function() {
            if (!this.value) {
                this.value = '+7 (';
            }
            if (this.selectionStart < MIN_LENGTH) {
                this.setSelectionRange(MIN_LENGTH, MIN_LENGTH);
            }
        });

        // Обработчик клавиш
        phoneInput.addEventListener('keydown', function(e) {
            const cursorPos = this.selectionStart;

            // Запрещаем удаление фиксированной части маски
            if (e.key === 'Backspace' && cursorPos <= MIN_LENGTH) {
                e.preventDefault();
                return;
            }

            // Запрещаем удаление влево за пределы редактируемой части
            if (e.key === 'Delete' && cursorPos < MIN_LENGTH) {
                e.preventDefault();
                return;
            }

            // Стрелка влево - не даём уйти в фиксированную часть
            if (e.key === 'ArrowLeft' && cursorPos <= MIN_LENGTH) {
                e.preventDefault();
                this.setSelectionRange(MIN_LENGTH, MIN_LENGTH);
                return;
            }

            // Home - ставим курсор после фиксированной части
            if (e.key === 'Home') {
                e.preventDefault();
                this.setSelectionRange(MIN_LENGTH, MIN_LENGTH);
                return;
            }
        });

        // Обработчик потери фокуса - валидация
        phoneInput.addEventListener('blur', function() {
            let value = this.value;
            let digits = value.replace(/\D/g, '');

            if (digits.startsWith('8')) {
                digits = '7' + digits.slice(1);
            }

            // Проверяем, что введено ровно 11 цифр
            if (digits.length !== 11 || !digits.startsWith('7')) {
                this.value = '';
            } else {
                this.value = formatPhone(digits);
            }
        });

        // Инициализация поля при загрузке
        if (phoneInput.value) {
            phoneInput.value = formatPhone(phoneInput.value);
        } else {
            phoneInput.value = '+7 (';
        }

        // Сохраняем начальное значение
        phoneInput.dataset.prevValue = phoneInput.value;
    };

    // Экспорт функции для использования в других скриптах
    window.PhoneMaskUtils = {
        initPhoneMask: initPhoneMask,
        formatPhone: formatPhone,
        MIN_LENGTH: MIN_LENGTH
    };

    // Автоматическая инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', function() {
        // Инициализируем маску для всех полей с id, содержащим 'phone' или 'username'
        const phoneInputs = document.querySelectorAll('input[id*="phone"], input[id*="username"]');
        phoneInputs.forEach(function(input) {
            // Проверяем, что это поле для телефона (по label или name)
            const label = document.querySelector('label[for="' + input.id + '"]');
            if (label && (label.textContent.toLowerCase().includes('телефон') || label.textContent.toLowerCase().includes('phone'))) {
                initPhoneMask(input);
            }
        });

        // Также инициализируем для конкретных ID
        const specificIds = ['id_phone', 'id_username'];
        specificIds.forEach(function(id) {
            const input = document.getElementById(id);
            if (input) {
                initPhoneMask(input);
            }
        });
    });
})();
