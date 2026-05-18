from django.apps import AppConfig
from django.contrib.auth.models import User


def sync_user_permissions_with_groups(sender, instance, action, pk_set, **kwargs):
    """
    Сигнал для синхронизации прав пользователя при изменении его групп.
    При добавлении пользователя в группу - добавляются права группы.
    При удалении пользователя из группы - права группы не удаляются (чтобы сохранить индивидуальные права).
    """
    # Обрабатываем только изменения для пользователей, а не для групп
    if not isinstance(instance, User):
        return
    
    if action == 'post_add':
        # Пользователя добавили в группу(ы) - добавляем права этих групп
        if pk_set:
            from django.contrib.auth.models import Group
            groups = Group.objects.filter(pk__in=pk_set)
            all_permissions = set()
            for group in groups:
                all_permissions.update(group.permissions.all())
            if all_permissions:
                instance.user_permissions.add(*all_permissions)


class CoreConfig(AppConfig):
    name = 'core'
    
    def ready(self):
        # Подключаем сигнал к модели User через поле groups
        from django.db.models.signals import m2m_changed
        from django.contrib.auth.models import User
        m2m_changed.connect(
            sync_user_permissions_with_groups,
            sender=User.groups.through
        )
        
        # Также подключаем сигнал для синхронизации прав всех пользователей группы при изменении прав группы
        from .models import GroupPermissionsSyncHandler
        GroupPermissionsSyncHandler.connect()
