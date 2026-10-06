"""Initialize productivity.db without starting the API."""

from app.database import DB_PATH, initialize_database


if __name__ == "__main__":
    initialize_database()
    print(f"Initialized task database at: {DB_PATH}")
