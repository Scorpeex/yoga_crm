// Календарь занятий - основной скрипт
let calendar;
let currentEventId = null;
let selectedDateFromClick = null; // Сохраняем дату из клика по календарю
let currentSessionId = null; // ID текущей сессии для управления посещаемостью

document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ru',
        firstDay: 1,
        timeZone: 'local',  // Используем локальное время браузера
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
        },
        buttonText: {
            today: 'Сегодня',
            month: 'Месяц',
            week: 'Неделя',
            day: 'День',
            list: 'Список'
        },
        events: {
            url: '/api/calendar/events/',
            // FullCalendar автоматически передаст start и end параметры
        },
        // Полная кастомизация рендеринга события - формат: "ЧЧ:ММ Название | Зал"
        eventContent: function(info) {
            const startTime = info.event.start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const className = info.event.title;
            const hallName = info.event.extendedProps.hall_name || '';
            
            let displayText = className;
            if (hallName) {
                displayText = ` ${className} | ${hallName}`;
            }
            
            return {
                html: `<div style="width: 100%; height: 100%; background-color: ${info.event.backgroundColor}; border-radius: 3px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px; padding: 2px; text-align: center;">
                    <div style="font-size: 12px; opacity: 0.9;">${startTime}${displayText}</div>
                </div>`
            };
        },
        editable: true,
        selectable: true,
        selectMirror: true,
        dayMaxEvents: true,
        
        // Клик по дате - создание нового события
        select: function(info) {
            // Определяем роль пользователя
            const userRole = window.USER_ROLE || 'student';
            const isStaff = userRole === 'admin' || userRole === 'moderator';
            
            // Для обычных пользователей запрещаем создание событий
            if (!isStaff) {
                calendar.unselect(); // Снимаем выделение
                return;
            }
            
            // При явном выборе времени используем локальную дату без конвертации
            // info.start теперь в локальном времени браузера (без timeZone конвертации)
            const localStart = info.start;
            const year = localStart.getFullYear();
            const month = (localStart.getMonth() + 1).toString().padStart(2, '0');
            const day = localStart.getDate().toString().padStart(2, '0');
            const hours = localStart.getHours().toString().padStart(2, '0');
            const minutes = localStart.getMinutes().toString().padStart(2, '0');
            selectedDateFromClick = `${year}-${month}-${day}T${hours}:${minutes}`;
            openModal(null, selectedDateFromClick);
        },
        
        // Клик по событию - редактирование/запись
        eventClick: function(info) {
            // Определяем роль пользователя
            const userRole = window.USER_ROLE || 'student';
            const isStaff = userRole === 'admin' || userRole === 'moderator';
            
            // Для обычных пользователей открываем только вкладку записи
            // Модальное окно откроется в openModal с правильной логикой
            openModal(info.event);
        },
        
        // Перетаскивание события
        eventDrop: function(info) {
            updateEvent(info.event);
        },
        
        // Изменение длительности
        eventResize: function(info) {
            updateEvent(info.event);
        }
    });
    
    calendar.render();
    
    // Настройка модального окна
    const modal = document.getElementById('eventModal');
    const closeBtn = document.querySelector('.close');
    
    closeBtn.onclick = function() {
        closeModal();
    };
    
    window.onclick = function(event) {
        if (event.target == modal) {
            closeModal();
        }
        // Закрытие модального окна выбора времени при клике вне его
        const timePickerModal = document.getElementById('timePickerModal');
        if (event.target == timePickerModal) {
            closeTimePicker();
        }
    };
    
    // Инициализация выпадающих списков часов и минут
    initTimeSelects();
    
    // Обработка формы
    document.getElementById('eventForm').onsubmit = function(e) {
        e.preventDefault();
        saveEvent();
    };
    
    // Удаление события
    document.getElementById('deleteBtn').onclick = function() {
        if (currentEventId) {
            deleteEvent(currentEventId);
        }
    };
    
    // Обработчики для модального окна подтверждения удаления
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
    
    closeDeleteModalBtn.onclick = function() {
        deleteConfirmModal.style.display = 'none';
    };
    
    window.onclick = function(event) {
        if (event.target == modal) {
            closeModal();
        }
        // Закрытие модального окна подтверждения удаления при клике вне его
        if (event.target == deleteConfirmModal) {
            deleteConfirmModal.style.display = 'none';
        }
    };
    
    document.getElementById('cancelDeleteBtn').addEventListener('click', function() {
        deleteConfirmModal.style.display = 'none';
    });
    
    document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
        confirmDeleteAction();
    });
    
    // Автозаполнение длительности при выборе типа занятия
    document.getElementById('eventClassType').addEventListener('change', function(e) {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const duration = selectedOption.getAttribute('data-duration');
        if (duration) {
            document.getElementById('eventDuration').value = duration;
        }
    });
    
    // Обработчики для кнопок выбора вместимости
    document.querySelectorAll('.capacity-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Снимаем активный класс со всех кнопок
            document.querySelectorAll('.capacity-btn').forEach(b => b.classList.remove('active'));
            // Добавляем активный класс нажатой кнопке
            this.classList.add('active');
            // Устанавливаем значение в поле ввода
            document.getElementById('eventMaxParticipants').value = this.getAttribute('data-value');
        });
    });
    
    // При вводе значения в поле вручную - снимаем выделение с кнопок
    document.getElementById('eventMaxParticipants').addEventListener('input', function() {
        document.querySelectorAll('.capacity-btn').forEach(b => b.classList.remove('active'));
    });
    
    // Функция для обновления состояния кнопок вместимости
    window.updateCapacityButtons = function(value) {
        document.querySelectorAll('.capacity-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-value') === value.toString()) {
                btn.classList.add('active');
            }
        });
    }
    
    // Инициализация выпадающих списков часов и минут
    initTimeSelects();
    
    // Обработчики вкладок
    initTabs();
});

// Инициализация вкладок
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            // Убираем активный класс со всех кнопок и панелей
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            // Добавляем активный класс текущей кнопке и панели
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            // Если переключились на вкладку посещаемости и есть ID сессии - загружаем данные
            if (tabId === 'attendance-tab' && currentSessionId) {
                loadAttendance(currentSessionId);
            }
        });
    });
}

function openModal(event, startStr) {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteBtn');
    const selectedDateSpan = document.getElementById('selectedDate');
    const classTabBtn = document.getElementById('classTabBtn');
    const attendanceTabBtn = document.getElementById('attendanceTabBtn');
    const saveEventBtn = document.getElementById('saveEventBtn');
    
    // Определяем роль пользователя
    const userRole = window.USER_ROLE || 'student';
    const isStaff = userRole === 'admin' || userRole === 'moderator';
    
    // Для обычных пользователей скрываем вкладку редактирования
    if (!isStaff) {
        classTabBtn.style.display = 'none';
        attendanceTabBtn.style.display = 'inline-block';
        // Переключаемся на вкладку записи
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        attendanceTabBtn.classList.add('active');
        document.getElementById('attendance-tab').classList.add('active');
    } else {
        classTabBtn.style.display = 'inline-block';
        attendanceTabBtn.style.display = 'inline-block';
    }
    
    // Извлекаем дату из startStr (формат YYYY-MM-DD или YYYY-MM-DDTHH:MM:SS)
    let selectedDate = '';
    let selectedTime = '';
    if (startStr) {
        selectedDate = startStr.slice(0, 10); // YYYY-MM-DD
        if (startStr.length > 11) {
            selectedTime = startStr.slice(11, 16); // HH:MM
        }
    }
    
    if (event) {
        // Редактирование существующего события
        currentEventId = event.id;
        currentSessionId = event.id; // Сохраняем ID сессии для посещаемости
        modalTitle.textContent = isStaff ? 'Редактировать занятие' : 'Запись на занятие';
        document.getElementById('eventId').value = event.id;
        
        // Устанавливаем тип занятия (по названию ищем в списке)
        const classTypeSelect = document.getElementById('eventClassType');
        const eventTitle = event.title;
        for (let option of classTypeSelect.options) {
            if (option.text === eventTitle) {
                classTypeSelect.value = option.value;
                // Триггерим изменение для обновления длительности
                classTypeSelect.dispatchEvent(new Event('change'));
                break;
            }
        }
        
        // Время начала - берем локальные часы и минуты напрямую, чтобы избежать проблем с timezone
        const startHours = event.start.getHours().toString().padStart(2, '0');
        const startMinutes = event.start.getMinutes().toString().padStart(2, '0');
        document.getElementById('startHour').value = startHours;
        document.getElementById('startMinute').value = startMinutes;
        
        // Показываем дату
        selectedDateSpan.textContent = event.start.toLocaleDateString('ru-RU');
        
        document.getElementById('eventDuration').value = event.extendedProps.duration || 60;
        const maxParticipants = event.extendedProps.max_participants || 20;
        document.getElementById('eventMaxParticipants').value = maxParticipants;
        updateCapacityButtons(maxParticipants);
        document.getElementById('eventHall').value = event.extendedProps.hall_id || '';
        
        // Повторяющееся событие
        const isRecurring = event.extendedProps.is_recurring || false;
        document.getElementById('eventRecurring').checked = isRecurring;
        // Для повторяющихся событий показываем специальный текст при удалении
        if (isRecurring) {
            deleteBtn.setAttribute('data-is-recurring', 'true');
            deleteBtn.setAttribute('data-recurrence-id', event.extendedProps.recurrence_id || '');
        } else {
            deleteBtn.removeAttribute('data-is-recurring');
            deleteBtn.removeAttribute('data-recurrence-id');
        }
        
        // Для обычных пользователей скрываем кнопку удаления
        if (isStaff) {
            deleteBtn.style.display = 'inline-block';
            saveEventBtn.style.display = 'inline-block';
        } else {
            deleteBtn.style.display = 'none';
            saveEventBtn.style.display = 'none';
        }
    } else {
        // Создание нового события
        currentEventId = null;
        currentSessionId = null; // Нет сессии для нового события
        modalTitle.textContent = 'Новое занятие';
        document.getElementById('eventId').value = '';
        document.getElementById('eventClassType').value = '';
        
        // Время из клика или пустое (без значения по умолчанию)
        if (selectedTime && selectedTime.includes('T')) {
            // Разбираем время из selectedTime (формат "YYYY-MM-DDTHH:MM")
            const timeParts = selectedTime.split('T')[1].split(':');
            document.getElementById('startHour').value = timeParts[0];
            document.getElementById('startMinute').value = timeParts[1];
        } else {
            // Значения по умолчанию: 09:00
            document.getElementById('startHour').value = '09';
            document.getElementById('startMinute').value = '00';
        }
        
        // Показываем выбранную дату
        if (selectedDate) {
            const dateObj = new Date(selectedDate);
            selectedDateSpan.textContent = dateObj.toLocaleDateString('ru-RU', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } else {
            selectedDateSpan.textContent = new Date().toLocaleDateString('ru-RU');
        }
        
        document.getElementById('eventDuration').value = 60;
        document.getElementById('eventMaxParticipants').value = 20;
        updateCapacityButtons(20);
        document.getElementById('eventHall').value = '';
        document.getElementById('eventRecurring').checked = false;
        deleteBtn.removeAttribute('data-is-recurring');
        deleteBtn.removeAttribute('data-recurrence-id');
        deleteBtn.style.display = 'none';
        
        // Для обычных пользователей скрываем кнопку сохранения при создании
        if (!isStaff) {
            saveEventBtn.style.display = 'none';
        } else {
            saveEventBtn.style.display = 'inline-block';
        }
    }
    
    modal.style.display = 'block';
    
    // Если это существующее событие и обычный пользователь - загружаем данные о записи
    if (event && !isStaff) {
        loadAttendanceForStudent(currentEventId);
    }
}

function closeModal() {
    document.getElementById('eventModal').style.display = 'none';
    document.getElementById('eventForm').reset();
    // Сбрасываем вкладки на первую
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="class-tab"]').classList.add('active');
    document.getElementById('class-tab').classList.add('active');
}

// Инициализация выпадающих списков часов и минут (08-20 часы, 00-50 минуты с шагом 10)
function initTimeSelects() {
    const startHour = document.getElementById('startHour');
    const startMinute = document.getElementById('startMinute');
    
    // Генерация часов (08-20)
    for (let h = 8; h <= 20; h++) {
        const option = document.createElement('option');
        option.value = h.toString().padStart(2, '0');
        option.textContent = h.toString().padStart(2, '0');
        startHour.appendChild(option);
    }
    
    // Генерация минут (00-50 с шагом 10)
    for (let m = 0; m < 60; m += 10) {
        const option = document.createElement('option');
        option.value = m.toString().padStart(2, '0');
        option.textContent = m.toString().padStart(2, '0');
        startMinute.appendChild(option);
    }
}

function formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    // Используем локальное время вместо UTC
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function saveEvent() {
    const eventId = document.getElementById('eventId').value;
    
    // Собираем время из двух выпадающих списков
    const hour = document.getElementById('startHour').value;
    const minute = document.getElementById('startMinute').value;
    const timeValue = `${hour}:${minute}`;
    
    const data = {
        class_type_id: parseInt(document.getElementById('eventClassType').value),
        start: timeValue,
        duration: parseInt(document.getElementById('eventDuration').value),
        hall_id: document.getElementById('eventHall').value || null,
        max_participants: parseInt(document.getElementById('eventMaxParticipants').value),
        is_recurring: document.getElementById('eventRecurring').checked,
    };
    
    // Если создаем новое событие, используем дату из клика по календарю
    if (!eventId) {
        if (selectedDateFromClick) {
            // Берем дату из selectedDateFromClick и время из выпадающих списков
            const datePart = selectedDateFromClick.slice(0, 10); // YYYY-MM-DD
            data.start = `${datePart}T${timeValue}`;
        } else {
            const today = new Date();
            // Используем локальную дату вместо UTC
            const year = today.getFullYear();
            const month = (today.getMonth() + 1).toString().padStart(2, '0');
            const day = today.getDate().toString().padStart(2, '0');
            const datePart = `${year}-${month}-${day}`;
            data.start = `${datePart}T${data.start}`;
        }
    } else {
        // При редактировании нужно получить полную дату из события календаря
        const eventObj = calendar.getEventById(eventId);
        if (eventObj) {
            // Используем локальные компоненты даты для избежания проблем с timezone
            const year = eventObj.start.getFullYear();
            const month = (eventObj.start.getMonth() + 1).toString().padStart(2, '0');
            const day = eventObj.start.getDate().toString().padStart(2, '0');
            const datePart = `${year}-${month}-${day}`;
            data.start = `${datePart}T${data.start}`;
        }
    }
    
    const url = eventId ? `/api/calendar/events/${eventId}/` : '/api/calendar/events/create/';
    const method = eventId ? 'PUT' : 'POST';
    
    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            calendar.refetchEvents();
            closeModal();
        } else {
            alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
        }
    })
    .catch(error => {
        alert('Ошибка при сохранении: ' + error);
    });
}

function updateEvent(event) {
    // Форматируем дату в локальном формате без UTC конвертации
    const year = event.start.getFullYear();
    const month = (event.start.getMonth() + 1).toString().padStart(2, '0');
    const day = event.start.getDate().toString().padStart(2, '0');
    const hours = event.start.getHours().toString().padStart(2, '0');
    const minutes = event.start.getMinutes().toString().padStart(2, '0');
    const seconds = event.start.getSeconds().toString().padStart(2, '0');
    
    const data = {
        start: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`,
        duration: event.end ? Math.round((event.end - event.start) / 60000) : 60,
    };
    
    fetch(`/api/calendar/events/${event.id}/`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            calendar.refetchEvents();
            alert('Ошибка при обновлении: ' + (data.error || 'Неизвестная ошибка'));
        }
    })
    .catch(error => {
        calendar.refetchEvents();
        console.error('Error:', error);
    });
}

function deleteEvent(eventId) {
    // Проверяем, является ли событие повторяющимся
    const deleteBtn = document.getElementById('deleteBtn');
    const isRecurring = deleteBtn.getAttribute('data-is-recurring') === 'true';
    
    if (isRecurring) {
        // Открываем модальное окно подтверждения удаления
        openDeleteConfirmModal(eventId);
    } else {
        // Обычное удаление для не повторяющихся событий
        performDelete(eventId);
    }
}

// Глобальная переменная для хранения ID события при удалении
let eventToDeleteId = null;

function openDeleteConfirmModal(eventId) {
    eventToDeleteId = eventId;
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    // Сбрасываем выбор на первый вариант по умолчанию
    document.getElementById('deleteSingle').checked = true;
    deleteConfirmModal.style.display = 'block';
}

function confirmDeleteAction() {
    if (!eventToDeleteId) return;
    
    const deleteSingle = document.getElementById('deleteSingle').checked;
    
    if (deleteSingle) {
        // Удаляем только одно занятие
        fetch(`/api/calendar/events/${eventToDeleteId}/delete/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ delete_single: true })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                calendar.refetchEvents();
                closeModal();
                document.getElementById('deleteConfirmModal').style.display = 'none';
                eventToDeleteId = null;
            } else {
                alert('Ошибка при удалении: ' + (data.error || 'Неизвестная ошибка'));
            }
        })
        .catch(error => {
            alert('Ошибка при удалении: ' + error);
        });
    } else {
        // Удаляем это и последующие занятия
        performDelete(eventToDeleteId);
        document.getElementById('deleteConfirmModal').style.display = 'none';
        eventToDeleteId = null;
    }
}


function performDelete(eventId) {
    fetch(`/api/calendar/events/${eventId}/delete/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCookie('csrftoken')
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            calendar.refetchEvents();
            closeModal();
        } else {
            alert('Ошибка при удалении: ' + (data.error || 'Неизвестная ошибка'));
        }
    })
    .catch(error => {
        alert('Ошибка при удалении: ' + error);
    });
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// ==================== ФУНКЦИИ ПОСЕЩАЕМОСТИ ====================

// Загрузка списка посещаемости для занятия
function loadAttendance(sessionId) {
    const attendanceContent = document.getElementById('attendanceContent');
    attendanceContent.innerHTML = '<p style="text-align: center; color: #666;">Загрузка...</p>';
    
    fetch(`/api/calendar/events/${sessionId}/attendance/`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Сохраняем max_participants в глобальной переменной
                window.currentMaxParticipants = data.max_participants || 10;
                renderAttendanceList(data.attendances);
            } else {
                attendanceContent.innerHTML = `<p style="color: red;">Ошибка: ${data.error}</p>`;
            }
        })
        .catch(error => {
            attendanceContent.innerHTML = `<p style="color: red;">Ошибка при загрузке: ${error}</p>`;
        });
}

// Рендеринг списка посещаемости
function renderAttendanceList(attendances, forStudent = false) {
    const attendanceContent = document.getElementById('attendanceContent');
    const userRole = window.USER_ROLE || 'student';
    const isStaff = userRole === 'admin' || userRole === 'moderator';
    
    // Получаем max_participants из ответа API (глобальная переменная)
    const maxParticipants = window.currentMaxParticipants || 10;
    const freeSlots = maxParticipants - attendances.length;
    
    let html = '';
    
    // Список записанных клиентов
    html += '<div class="attendance-list">';
    html += '<h4 style="margin-bottom: 10px; color: #555;">Записанные клиенты</h4>';
    
    if (attendances.length === 0) {
        html += '<p style="color: #999; font-style: italic;">Пока нет записанных клиентов</p>';
    } else {
        attendances.forEach(attendance => {
            const roleBadge = attendance.role ? `<span class="role-badge" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background-color: ${attendance.role === 'admin' ? '#dc3545' : (attendance.role === 'moderator' ? '#ffc107' : '#6c757d')}; color: white; margin-left: 8px;">${attendance.role === 'admin' ? 'Админ' : (attendance.role === 'moderator' ? 'Модератор' : '')}</span>` : '';
            html += `
                <div class="attendance-item">
                    ${isStaff ? `<input type="checkbox" id="client-${attendance.client_id}" 
                           data-client-id="${attendance.client_id}" 
                           ${attendance.attended ? 'checked' : ''}>` : ''}
                    <label for="client-${attendance.client_id}">
                        <span class="client-name">${attendance.client_name}${roleBadge}</span>
                        ${attendance.client_phone ? `<span class="client-phone">${attendance.client_phone}</span>` : ''}
                    </label>
                </div>
            `;
        });
    }
    
    html += '</div>';
    
    // Информация о свободных местах
    html += `<div style="margin: 15px 0; padding: 10px; background-color: #f0f8ff; border-radius: 5px;">
        <strong>Свободные места:</strong> ${freeSlots} из ${maxParticipants}
    </div>`;
    
    // Кнопка сохранения посещаемости (только для персонала)
    if (isStaff) {
        html += `
            <div class="attendance-actions">
                <button type="button" class="btn btn-primary" onclick="saveAttendance()">Сохранить</button>
            </div>
        `;
    }
    
    // Кнопки записи/отмены для обычного пользователя
    if (!isStaff && currentEventId) {
        const currentUserIsEnrolled = attendances.some(a => a.is_current_user);
        const canEnroll = freeSlots > 0;
        
        // Проверяем время до занятия
        const eventElement = calendar.getEventById(currentEventId);
        let canAction = true;
        if (eventElement) {
            const now = new Date();
            const eventStart = eventElement.start;
            const hoursUntilEvent = (eventStart - now) / (1000 * 60 * 60);
            canAction = hoursUntilEvent > 4;
        }
        
        if (currentUserIsEnrolled) {
            if (canAction) {
                html += `
                    <div class="attendance-actions">
                        <button type="button" class="btn btn-danger" onclick="cancelEnrollment(${currentEventId})">Отменить запись</button>
                    </div>
                `;
            } else {
                html += `<p style="color: #999; font-style: italic; margin-top: 10px;">Отмена записи возможна не позднее чем за 4 часа до начала занятия</p>`;
            }
        } else {
            if (canEnroll) {
                if (canAction) {
                    html += `
                        <div class="attendance-actions">
                            <button type="button" class="btn btn-primary" onclick="enrollToClass(${currentEventId})">Записаться на занятие</button>
                        </div>
                    `;
                } else {
                    html += `<p style="color: #999; font-style: italic; margin-top: 10px;">Запись возможна не позднее чем за 4 часа до начала занятия</p>`;
                }
            } else {
                html += `<p style="color: #999; font-style: italic; margin-top: 10px;">Нет свободных мест</p>`;
            }
        }
    }
    
    // Секция добавления клиента вручную (только для персонала)
    if (isStaff) {
        html += `
            <div class="add-client-section">
                <h4>Добавить клиента вручную</h4>
                <div class="client-search">
                    <input type="text" id="clientSearchInput" placeholder="Поиск по имени или телефону..." oninput="searchClients(this.value)">
                    <button type="button" class="btn btn-secondary btn-small" onclick="closeSearchResults()">✕</button>
                </div>
                <div id="clientSearchResults" class="client-search-results"></div>
            </div>
        `;
    }
    
    attendanceContent.innerHTML = html;
}

// Поиск клиентов
let searchTimeout = null;
function searchClients(query) {
    const resultsDiv = document.getElementById('clientSearchResults');
    
    // Очищаем предыдущий таймер
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    if (!query || query.length < 2) {
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
        return;
    }
    
    // Задержка перед запросом для избежания частых запросов
    searchTimeout = setTimeout(() => {
        fetch(`/api/clients/search/?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                if (data.clients && data.clients.length > 0) {
                    let html = '';
                    data.clients.forEach(client => {
                        html += `
                            <div class="client-search-result-item" onclick="addClientToSession(${client.id})">
                                <strong>${client.name}</strong>
                                ${client.phone ? `<br><small>${client.phone}</small>` : ''}
                            </div>
                        `;
                    });
                    resultsDiv.innerHTML = html;
                    resultsDiv.style.display = 'block';
                } else {
                    resultsDiv.innerHTML = '<div class="client-search-result-item" style="color: #999;">Клиенты не найдены</div>';
                    resultsDiv.style.display = 'block';
                }
            })
            .catch(error => {
                resultsDiv.innerHTML = `<div class="client-search-result-item" style="color: red;">Ошибка: ${error}</div>`;
                resultsDiv.style.display = 'block';
            });
    }, 300);
}

// Закрытие результатов поиска
function closeSearchResults() {
    const resultsDiv = document.getElementById('clientSearchResults');
    const input = document.getElementById('clientSearchInput');
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (resultsDiv) resultsDiv.innerHTML = '';
    if (input) input.value = '';
}

// Добавление клиента на занятие
function addClientToSession(clientId) {
    if (!currentSessionId) {
        alert('Сначала сохраните занятие');
        return;
    }
    
    fetch(`/api/calendar/events/${currentSessionId}/attendance/add/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({ client_id: clientId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Перезагружаем список посещаемости
            loadAttendance(currentSessionId);
            closeSearchResults();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    })
    .catch(error => {
        alert(`Ошибка при добавлении: ${error}`);
    });
}

// Сохранение посещаемости
function saveAttendance() {
    if (!currentSessionId) {
        alert('Сначала сохраните занятие');
        return;
    }
    
    // Собираем ID клиентов, которые отметились как посетившие
    const attendedClients = [];
    document.querySelectorAll('.attendance-item input[type="checkbox"]').forEach(checkbox => {
        if (checkbox.checked) {
            attendedClients.push(parseInt(checkbox.getAttribute('data-client-id')));
        }
    });
    
    fetch(`/api/calendar/events/${currentSessionId}/attendance/update/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({ attended_clients: attendedClients })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Посещаемость сохранена');
            // Перезагружаем список для обновления статусов
            loadAttendance(currentSessionId);
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    })
    .catch(error => {
        alert(`Ошибка при сохранении: ${error}`);
    });
}

// Загрузка данных о записи для обычного пользователя
function loadAttendanceForStudent(sessionId) {
    const attendanceContent = document.getElementById('attendanceContent');
    attendanceContent.innerHTML = '<p style="text-align: center; color: #666;">Загрузка...</p>';
    
    fetch(`/api/calendar/events/${sessionId}/attendance/`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Сохраняем max_participants в глобальной переменной
                window.currentMaxParticipants = data.max_participants || 10;
                renderAttendanceList(data.attendances, true);
            } else {
                attendanceContent.innerHTML = `<p style="color: red;">Ошибка: ${data.error}</p>`;
            }
        })
        .catch(error => {
            attendanceContent.innerHTML = `<p style="color: red;">Ошибка при загрузке: ${error}</p>`;
        });
}

// Запись на занятие
function enrollToClass(sessionId) {
    fetch(`/api/calendar/events/${sessionId}/enroll/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Вы успешно записаны на занятие');
            // Перезагружаем список и обновляем календарь
            loadAttendanceForStudent(sessionId);
            calendar.refetchEvents();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    })
    .catch(error => {
        alert(`Ошибка при записи: ${error}`);
    });
}

// Отмена записи на занятие
function cancelEnrollment(sessionId) {
    if (!confirm('Вы уверены, что хотите отменить запись?')) {
        return;
    }
    
    fetch(`/api/calendar/events/${sessionId}/cancel-enrollment/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Запись отменена');
            // Перезагружаем список и обновляем календарь
            loadAttendanceForStudent(sessionId);
            calendar.refetchEvents();
        } else {
            alert(`Ошибка: ${data.error}`);
        }
    })
    .catch(error => {
        alert(`Ошибка при отмене записи: ${error}`);
    });
}
