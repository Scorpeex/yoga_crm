from django import forms


class CheckboxSelectMultiplePermissions(forms.CheckboxSelectMultiple):
    """
    Виджет для отображения прав доступа в виде таблицы,
    сгруппированных по моделям (Приложение | Модель).
    Колонки: Название прав, Add, Change, Delete, View.
    """
    template_name = 'core/admin/widgets/permissions_checkboxes.html'

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
                    grouped_choices[group_key] = {
                        'add': None,
                        'change': None,
                        'delete': None,
                        'view': None,
                    }
                
                # Определяем тип действия по метке
                action_lower = action_label.lower()
                if action_lower.startswith('add') or action_lower.startswith('добавить'):
                    grouped_choices[group_key]['add'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif action_lower.startswith('change') or action_lower.startswith('изменить') or action_lower.startswith('менять'):
                    grouped_choices[group_key]['change'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif action_lower.startswith('delete') or action_lower.startswith('удалить'):
                    grouped_choices[group_key]['delete'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }
                elif action_lower.startswith('view') or action_lower.startswith('просмотр'):
                    grouped_choices[group_key]['view'] = {
                        'value': val,
                        'selected': selected,
                        'id': f"id_{name}_{val}"
                    }

        context['widget']['grouped_choices'] = grouped_choices
        return context
