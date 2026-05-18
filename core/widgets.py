from django import forms


class CheckboxSelectMultiplePermissions(forms.CheckboxSelectMultiple):
    """
    Виджет для отображения прав доступа в виде списка чекбоксов,
    сгруппированных по моделям (Приложение | Модель).
    """
    template_name = 'core/admin/widgets/permissions_checkboxes.html'

    def get_context(self, name, value, attrs):
        context = super().get_context(name, value, attrs)
        
        # Пересобираем данные для удобной группировки в шаблоне
        grouped_choices = {}
        current_value = [str(v) for v in (value or [])]
        
        for option in context['widget']['options']:
            label = option['label']
            val = option['value']
            selected = option['selected']
            
            parts = str(label).split(' | ')
            if len(parts) >= 2:
                group_name = f"{parts[0]} <span class='text-muted'>| {parts[1]}</span>"
                action_label = parts[2] if len(parts) > 2 else label
            else:
                group_name = 'Прочее'
                action_label = label

            if group_name not in grouped_choices:
                grouped_choices[group_name] = []
            
            grouped_choices[group_name].append({
                'value': val,
                'label': action_label,
                'selected': selected,
                'id': f"id_{name}_{val}"
            })

        context['widget']['grouped_choices'] = grouped_choices
        return context
