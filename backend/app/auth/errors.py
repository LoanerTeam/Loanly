from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AuthError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status, self.code, self.detail = status, code, detail


async def auth_error_handler(request: Request, error: AuthError) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else None
    return JSONResponse(
        status_code=error.status, content={"error": error.code, "detail": error.detail},
        headers=headers,
    )


async def validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    # Never echo validation inputs: they may contain a password or a bearer token.
    return JSONResponse(status_code=422, content={
        "error": "validation_error", "detail": "Check the required fields and their format.",
    })
