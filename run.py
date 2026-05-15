from app import create_app
from flask import render_template

app = create_app()
app.config['MAX_CONTENT_LENGTH'] = 2000 * 1024 * 1024 

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)