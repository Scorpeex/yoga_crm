from django import forms


class CheckboxSelectMultiplePermissions(forms.CheckboxSelectMultiple):
    """
    Виджет для отображения прав доступа в виде таблицы,
    сгруппированных по моделям (Приложение | Модель).
    Колонки: Название прав, Add, Change, Delete, View.
    """
    template_name = 'core/admin/widgets/permissions_checkboxes.html'
    
    # Подробные описания для каждой группы прав
    PERMISSION_DESCRIPTIONS = {
        'auth | log entry': 'Логи всех действий в админке (кто, когда и что изменил). Доступ только для администраторов для аудита.',
        'auth | group': 'Модель групп пользователей. Права нужны для создания и изменения групп. Только для администраторов.',
        'auth | permission': 'Сами разрешения (галочки в настройках). Права даются только разработчикам или суперпользователям.',
        'contenttypes | content type': 'Служебная модель, используемая внутри Django. Не требует предоставления прав обычным пользователям.',
        'core | посещение': 'Факт прихода клиента на занятие. Права позволяют отмечать приход, просматривать историю и исправлять ошибки.',
        'core | запись на занятие': 'Заявка клиента на будущее занятие. Ключевое право для учеников - позволяет записываться на занятия.',
        'core | занятие': 'Расписание уроков. Права позволяют смотреть, создавать, менять и отменять занятия.',
        'core | тип занятия': 'Справочник видов активности (йога, кроссфит и т.д.). Права нужны для просмотра и добавления новых направлений.',
        'core | зал': 'Справочник помещений. Права аналогичны типу занятия - просмотр и управление залами.',
        'core | оплата': 'Информация о платежах клиентов. Права позволяют принимать деньги, смотреть историю и корректировать платежи.',
        'core | финансовая операция': 'Более детальные бухгалтерские записи. Доступ ограничен бухгалтерией и владельцем.',
        'core | оплата аренды': 'Платежи арендаторов, если сдаете залы. Права только для менеджеров по аренде.',
        'core | абонемент': 'Сущности абонементов. Права позволяют просматривать и создавать новые абонементы.',
        'core | тариф': 'Настройки цен и правил. Управление тарифами - задача администратора.',
        'core | клиент': 'Карточки клиентов. Права позволяют смотреть, создавать, редактировать и удалять клиентов.',
        'core | настройки новых пользователей': 'Кастомная модель для настройки параметров при регистрации. Права только администраторам.',
        'sessions | session': 'Техническая информация о сессиях пользователей. Права не даются обычным пользователям.',
    }

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        
        # Пересобираем данные для табличного отображения
        grouped_choices = {}
        current_value = [str(v) for v in (value or [])]
        
        # optgroups - это список кортежей (group_name, options, group_index)
        for group_name, options, group_index in context['widget']['optgroups']:
            for option in options:
                label = option['label']
                val = option['value']
                selected = option['selected']
                
                parts = str(label).split(' | ')
                if len(parts) >= 2:
                    app_name = parts[0]
                    model_name = parts[1]
                    action_label = parts[2] if len(parts) > 2 else label
                    group_key = f"{app_name} | {model_name}"
                else:
                    group_key = 'Прочее'
                    action_label = label

                if group_key not in grouped_choices:
                    # Получаем описание из словаря или используем значение по умолчанию
                    description = self.PERMISSION_DESCRIPTIONS.get(group_key.lower(), 'Описание недоступно')
                    grouped_choices[group_key] = {
                        'add': None,
                        'change': None,
                        'delete': None,
                        'view': None,
                        'description': description,
                    }
                
                # Определяем тип действия по метке (формат Django: "Can add ...", "Can change ...", etc.)
                action_lower = action_label.lower()
                if 'add' in action_lower or action_lower.startswith('добавить'):
                    grouped_choices[group_key]['add'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif 'change' in action_lower or 'изменить' in action_lower or 'менять' in action_lower:
                    grouped_choices[group_key]['change'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif 'delete' in action_lower or 'удалить' in action_lower:
                    grouped_choices[group_key]['delete'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif 'view' in action_lower or 'просмотр' in action_lower:
                    grouped_choices[group_key]['view'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }

        context['widget']['grouped_choices'] = grouped_choices
        return context
