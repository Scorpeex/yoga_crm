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
