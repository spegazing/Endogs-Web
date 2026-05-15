from flask import Flask


def create_app():
    app = Flask(__name__)

    from .routes.upload import upd
    app.register_blueprint(upd)
    from .routes._process import process_bp
    app.register_blueprint(process_bp)

    from .routes.reconstruct import reconstruct_bp
    app.register_blueprint(reconstruct_bp)

    return app
