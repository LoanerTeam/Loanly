from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from app.auth import repo, security
from app.auth.errors import AuthError, auth_error_handler, validation_error_handler
from app.auth.router import router


def install_auth(app: FastAPI) -> None:
    """Register before the static frontend mount; errors follow the REST contract."""
    app.include_router(router, prefix="/api")
    app.add_exception_handler(AuthError, auth_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)


async def initialize_auth() -> None:
    security.validate_config()
    await repo.ensure_indexes()
