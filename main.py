from app import app
import os

def main():
    """Entry point for the Task Focus Dashboard."""
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5001))
    debug = os.getenv('FLASK_DEBUG', '0') == '1'
    
    print(f"\n🚀 Starting TaskFlow on http://{host}:{port}")
    print(f"🌐 Domain: {os.getenv('DOMAIN', 'localhost')}")
    print(f"📝 Debug mode: {debug}\n")
    
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()