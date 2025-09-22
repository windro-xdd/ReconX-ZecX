from fastapi import FastAPI, Response

app = FastAPI()

@app.get("/")
def root():
    return {"hello": "world"}

@app.get("/admin")
def admin():
    return Response("forbidden", status_code=403)

@app.get("/secret.txt")
def secret():
    return Response("topsecret", media_type="text/plain")
