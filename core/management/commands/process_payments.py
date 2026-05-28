"""
Management command для обработки платежей (устарел, используется только для совместимости)
Теперь списание происходит мгновенно при записи на занятие
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Устаревшая команда. Теперь списание происходит мгновенно при записи на занятие.'

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.WARNING(
                'Эта команда больше не используется. '
                'Списание средств происходит мгновенно при записи на занятие.'
            )
        )
