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
        timeZone: 'Asia/Novosibirsk',
        firstDay: 1,
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
            // При явном выборе времени используем локальную дату без конвертации
            // info.start уже содержит локальное время благодаря timeZone: 'Asia/Novosibirsk'
            const localStart = info.start;
            const year = localStart.getFullYear();
            const month = (localStart.getMonth() + 1).toString().padStart(2, '0');
            const day = localStart.getDate().toString().padStart(2, '0');
            const hours = localStart.getHours().toString().padStart(2, '0');
            const minutes = localStart.getMinutes().toString().padStart(2, '0');
            selectedDateFromClick = `${year}-${month}-${day}T${hours}:${minutes}`;
            openModal(null, selectedDateFromClick);
        },
        
        // Клик по событию - редактирование
        eventClick: function(info) {
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
    
    // Обработка поля выбора времени - открытие кастомного пикера
    const eventStartInput = document.getElementById('eventStart');
    eventStartInput.addEventListener('click', function() {
        openTimePicker();
    });
    
    // Инициализация сеток часов и минут
    initTimePicker();
    
    // Кнопки подтверждения/отмены выбора времени
    document.getElementById('confirmTimeBtn').addEventListener('click', function() {
        applyTimeSelection();
    });
    
    document.getElementById('cancelTimeBtn').addEventListener('click', function() {
        closeTimePicker();
    });
    
    document.getElementById('closeTimePicker').addEventListener('click', function() {
        closeTimePicker();
    });
    
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
        // Закрытие модального окна выбора времени при клике вне его
        const timePickerModal = document.getElementById('timePickerModal');
        if (event.target == timePickerModal) {
            closeTimePicker();
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
        modalTitle.textContent = 'Редактировать занятие';
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
        const startTime = `${startHours}:${startMinutes}`;
        document.getElementById('eventStart').value = startTime;
        
        // Показываем дату
        selectedDateSpan.textContent = event.start.toLocaleDateString('ru-RU');
        
        document.getElementById('eventDuration').value = event.extendedProps.duration || 60;
        document.getElementById('eventMaxParticipants').value = event.extendedProps.max_participants || 20;
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
        
        deleteBtn.style.display = 'inline-block';
    } else {
        // Создание нового события
        currentEventId = null;
        currentSessionId = null; // Нет сессии для нового события
        modalTitle.textContent = 'Новое занятие';
        document.getElementById('eventId').value = '';
        document.getElementById('eventClassType').value = '';
        
        // Время из клика или пустое (без значения по умолчанию)
        document.getElementById('eventStart').value = selectedTime || '';
        
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
        document.getElementById('eventHall').value = '';
        document.getElementById('eventRecurring').checked = false;
        deleteBtn.removeAttribute('data-is-recurring');
        deleteBtn.removeAttribute('data-recurrence-id');
        deleteBtn.style.display = 'none';
    }
    
    modal.style.display = 'block';
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

// Переменные для кастомного выбора времени
let selectedHour = null;
let selectedMinute = null;

// Инициализация столбцов часов и минут
function initTimePicker() {
    const hoursColumn = document.getElementById('hoursColumn');
    const minutesColumn = document.getElementById('minutesColumn');
    
    // Генерация часов (08-20) - только рабочие часы студии
    for (let h = 8; h <= 20; h++) {
        const hourBtn = document.createElement('div');
        hourBtn.textContent = h.toString().padStart(2, '0');
        hourBtn.style.cssText = 'padding: 8px; text-align: center; background: #f0f0f0; border-radius: 4px; cursor: pointer; user-select: none;';
        hourBtn.addEventListener('click', function() {
            // Снимаем выделение с других часов
            document.querySelectorAll('#hoursColumn div').forEach(el => el.style.background = '#f0f0f0');
            // Выделяем выбранный час
            hourBtn.style.background = '#4CAF50';
            hourBtn.style.color = 'white';
            selectedHour = h.toString().padStart(2, '0');
            // Если минуты уже выбраны, автоматически применяем время и закрываем окно
            if (selectedMinute !== null) {
                applyTimeSelection();
            }
        });
        hoursColumn.appendChild(hourBtn);
    }
    
    // Генерация минут (0-55 с шагом 5)
    for (let m = 0; m < 60; m += 5) {
        const minuteBtn = document.createElement('div');
        minuteBtn.textContent = m.toString().padStart(2, '0');
        minuteBtn.style.cssText = 'padding: 8px; text-align: center; background: #f0f0f0; border-radius: 4px; cursor: pointer; user-select: none;';
        minuteBtn.addEventListener('click', function() {
            // Снимаем выделение с других минут
            document.querySelectorAll('#minutesColumn div').forEach(el => el.style.background = '#f0f0f0');
            // Выделяем выбранную минуту
            minuteBtn.style.background = '#4CAF50';
            minuteBtn.style.color = 'white';
            selectedMinute = m.toString().padStart(2, '0');
            // Если часы уже выбраны, автоматически применяем время и закрываем окно
            if (selectedHour !== null) {
                applyTimeSelection();
            }
        });
        minutesColumn.appendChild(minuteBtn);
    }
}

// Открытие модального окна выбора времени
function openTimePicker() {
    const timePickerModal = document.getElementById('timePickerModal');
    const eventStartInput = document.getElementById('eventStart');
    
    // Сбрасываем предыдущий выбор только если поле пустое
    const hasExistingValue = eventStartInput.value.trim() !== '';
    
    if (!hasExistingValue) {
        // При первом открытии (пустое поле) сбрасываем выбор
        selectedHour = null;
        selectedMinute = null;
        document.querySelectorAll('#hoursColumn div, #minutesColumn div').forEach(el => {
            el.style.background = '#f0f0f0';
            el.style.color = 'black';
        });
    } else {
        // Если есть значение, оставляем его как выбранный
        const parts = eventStartInput.value.split(':');
        if (parts.length === 2) {
            selectedHour = parts[0];
            selectedMinute = parts[1];
        }
    }
    
    // Если есть время в поле, предварительно выбираем его (визуально выделяем)
    if (hasExistingValue && selectedHour && selectedMinute) {
        // Находим и выделяем соответствующие кнопки
        document.querySelectorAll('#hoursColumn div').forEach(el => {
            if (el.textContent === selectedHour) {
                el.style.background = '#4CAF50';
                el.style.color = 'white';
            } else {
                el.style.background = '#f0f0f0';
                el.style.color = 'black';
            }
        });
        document.querySelectorAll('#minutesColumn div').forEach(el => {
            if (el.textContent === selectedMinute) {
                el.style.background = '#4CAF50';
                el.style.color = 'white';
            } else {
                el.style.background = '#f0f0f0';
                el.style.color = 'black';
            }
        });
    }
    
    timePickerModal.style.display = 'block';
}

// Закрытие модального окна выбора времени
function closeTimePicker() {
    document.getElementById('timePickerModal').style.display = 'none';
}

// Применение выбранного времени
function applyTimeSelection() {
    if (selectedHour !== null && selectedMinute !== null) {
        const eventStartInput = document.getElementById('eventStart');
        eventStartInput.value = `${selectedHour}:${selectedMinute}`;
    }
    closeTimePicker();
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
    
    const data = {
        class_type_id: parseInt(document.getElementById('eventClassType').value),
        start: document.getElementById('eventStart').value,
        duration: parseInt(document.getElementById('eventDuration').value),
        hall_id: document.getElementById('eventHall').value || null,
        max_participants: parseInt(document.getElementById('eventMaxParticipants').value),
        is_recurring: document.getElementById('eventRecurring').checked,
    };
    
    // Если создаем новое событие, используем дату из клика по календарю
    if (!eventId) {
        if (selectedDateFromClick) {
            // selectedDateFromClick уже в правильном формате YYYY-MM-DDTHH:MM
            data.start = selectedDateFromClick;
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
function renderAttendanceList(attendances) {
    const attendanceContent = document.getElementById('attendanceContent');
    
    let html = '';
    
    // Список записанных клиентов
    html += '<div class="attendance-list">';
    html += '<h4 style="margin-bottom: 10px; color: #555;">Записанные клиенты</h4>';
    
    if (attendances.length === 0) {
        html += '<p style="color: #999; font-style: italic;">Пока нет записанных клиентов</p>';
    } else {
        attendances.forEach(attendance => {
            html += `
                <div class="attendance-item">
                    <input type="checkbox" id="client-${attendance.client_id}" 
                           data-client-id="${attendance.client_id}" 
                           ${attendance.attended ? 'checked' : ''}>
                    <label for="client-${attendance.client_id}">
                        <span class="client-name">${attendance.client_name}</span>
                        ${attendance.client_phone ? `<span class="client-phone">${attendance.client_phone}</span>` : ''}
                    </label>
                </div>
            `;
        });
    }
    
    html += '</div>';
    
    // Кнопка сохранения посещаемости
    html += `
        <div class="attendance-actions">
            <button type="button" class="btn btn-primary" onclick="saveAttendance()">Сохранить посещаемость</button>
        </div>
    `;
    
    // Секция добавления клиента вручную
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
