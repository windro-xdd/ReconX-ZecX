from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List

class Settings(BaseSettings):
    app_name: str = "ReconX"
    environment: str = Field(default="dev")
    log_level: str = Field(default="INFO")

    database_url: str | None = Field(default=None)
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5432)
    db_user: str = Field(default="postgres")
    db_password: str = Field(default="postgres")
    db_name: str = Field(default="reconx")

    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    cors_origins: List[str] = Field(default_factory=lambda: ["*"])
    authz_required: bool = Field(default=False)

    class Config:
        env_file = ".env"

settings = Settings()