import io
import pandas as pd
from typing import Dict, Any

from db.database import db_manager


def load_csv_to_table(table_name: str, csv_bytes: bytes, if_exists: str = "append") -> Dict[str, Any]:
    """Load CSV data into the specified table."""
    if if_exists not in {"append", "replace"}:
        return {"status": "error", "error": "Invalid if_exists option"}

    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
        conn = db_manager.get_connection()
        df.to_sql(table_name, conn, if_exists=if_exists, index=False)
        conn.commit()
        rows_loaded = len(df)
        db_manager.close_connection(conn)
        return {"status": "success", "rows_loaded": rows_loaded}
    except Exception as e:
        return {"status": "error", "error": str(e)}
