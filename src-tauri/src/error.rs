use serde::Serialize;
use std::fmt;

/// A user-facing error kind so the frontend can react differently
/// (e.g. show the persistent lock banner vs. a transient toast).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// No database has been opened / connected yet.
    NotConnected,
    /// The Access ODBC driver is not installed on this machine.
    DriverMissing,
    /// The file is locked / already in use (open in Access, or exclusive lock).
    Locked,
    /// The saved query needs parameters or is otherwise not runnable via ODBC.
    ParameterQuery,
    /// The requested table/query has no primary key -> writes are refused.
    NoPrimaryKey,
    /// Generic ODBC / driver error.
    Odbc,
    /// Anything else (IO, JSON, logic).
    Other,
}

/// Error type returned from every Tauri command. Serializes to a plain object
/// `{ kind, message }` so the TypeScript layer can pattern-match on `kind`.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        AppError {
            kind,
            message: message.into(),
        }
    }

    pub fn not_connected() -> Self {
        AppError::new(
            ErrorKind::NotConnected,
            "No database is open. Please open an .accdb file first.",
        )
    }

    pub fn other(message: impl Into<String>) -> Self {
        AppError::new(ErrorKind::Other, message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

/// Translate a low-level odbc-api error into a friendly, categorized AppError.
impl From<odbc_api::Error> for AppError {
    fn from(err: odbc_api::Error) -> Self {
        let raw = err.to_string();
        let lower = raw.to_lowercase();

        // Driver not installed. ODBC state IM002 / "Data source name not found".
        if lower.contains("im002")
            || lower.contains("data source name not found")
            || lower.contains("driver's sqlallochandle")
            || (lower.contains("driver") && lower.contains("not found"))
        {
            return AppError::new(
                ErrorKind::DriverMissing,
                "The 'Microsoft Access Driver (*.mdb, *.accdb)' ODBC driver was not found. \
                 Install the Microsoft Access Database Engine Redistributable (matching this app's \
                 64-bit architecture) and try again.",
            );
        }

        // File locked / opened exclusively / in use.
        if lower.contains("could not use")
            || lower.contains("already in use")
            || lower.contains("exclusively locked")
            || lower.contains("locked by user")
            || lower.contains("could not lock")
            || lower.contains("access denied")
            || lower.contains("being used by another")
        {
            return AppError::new(
                ErrorKind::Locked,
                "The database appears to be locked or opened exclusively (likely open in \
                 Microsoft Access). Close it in Access and retry.",
            );
        }

        // Parameter query: JET reports "Too few parameters. Expected N."
        if lower.contains("too few parameters") {
            return AppError::new(
                ErrorKind::ParameterQuery,
                "This query requires parameters or is an action query and cannot be run from \
                 this app. Please run it in Microsoft Access.",
            );
        }

        AppError::new(ErrorKind::Odbc, raw)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::other(format!("Data serialization error: {err}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::other(format!("File error: {err}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
