from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str
    JWT_SECRET: str
    ENCRYPTION_KEY: str

    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None

    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    BACKUP_STORAGE_PATH: str = "/data/backups"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    PASSWORD_RESET_EXPIRE_MINUTES: int = 60

    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 25
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@backup-intelligence.local"
    SMTP_TLS: bool = False

    FRONTEND_URL: str = "http://localhost:3000"
    API_URL: str = "http://localhost:8000"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost"

    CSRF_COOKIE_NAME: str = "csrf_token"
    SESSION_COOKIE_SECURE: bool = False

    RATE_LIMIT_DEFAULT: str = "200/minute"
    RATE_LIMIT_AUTH: str = "10/minute"

    PROMETHEUS_PORT: int = 9090

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def ai_provider(self) -> Literal["anthropic", "openai", "none"]:
        if self.ANTHROPIC_API_KEY:
            return "anthropic"
        if self.OPENAI_API_KEY:
            return "openai"
        return "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()
