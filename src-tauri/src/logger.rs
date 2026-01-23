use tracing_subscriber::{fmt, prelude::*, EnvFilter};

pub fn init_logging() {
    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_writer(std::io::stdout)
                .with_ansi(true)
        )
        .with(EnvFilter::from_default_env()
            .add_directive(tracing::Level::INFO.into())
        )
        .init();
}
