from fastapi import FastAPI

app = FastAPI(title="Logcraft AI Backend")

@app.get("/")
def read_root():
    return {"message": "Welcome to Logcraft AI API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
