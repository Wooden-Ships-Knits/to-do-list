from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://todo:todo@localhost:5455/todo"
    app_timezone: str = "Asia/Makassar"
    cors_origins: str = ""
    log_level: str = "INFO"
    # Send the session cookie only over HTTPS (set true behind TLS).
    cookie_secure: bool = False
    # A session ends after this many days without use.
    session_days: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
