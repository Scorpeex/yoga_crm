from django.core.management.base import BaseCommand
from core.seed_data import run_seed


class Command(BaseCommand):
    help = 'Наполнение базы данных тестовыми данными'

    def handle(self, *args, **options):
        run_seed()
