class AuthManager {
    constructor() {
        this.token = localStorage.getItem('webTerminalToken');
        this.user = null;
        this.loginForm = null;
        this.loginError = null;
        this.loginBtn = null;
        
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        this.loginForm = document.getElementById('login-form');
        this.loginError = document.getElementById('login-error');
        this.loginBtn = document.getElementById('login-btn');

        if (this.loginForm) {
            this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Check if user is already logged in
        if (this.token) {
            this.verifyToken();
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            this.showError('Please enter both username and password');
            return;
        }

        this.setLoading(true);
        this.hideError();

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.token = data.token;
                localStorage.setItem('webTerminalToken', this.token);
                
                // Extract user info from token
                this.user = this.parseJWT(this.token);
                
                this.onLoginSuccess();
            } else {
                this.showError(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Network error. Please try again.');
        } finally {
            this.setLoading(false);
        }
    }

    async verifyToken() {
        if (!this.token) {
            this.showLoginScreen();
            return false;
        }

        try {
            const response = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.user = data.user;
                this.onLoginSuccess();
                return true;
            } else {
                this.clearToken();
                this.showLoginScreen();
                return false;
            }
        } catch (error) {
            console.error('Token verification error:', error);
            this.clearToken();
            this.showLoginScreen();
            return false;
        }
    }

    logout() {
        this.clearToken();
        this.user = null;
        this.showLoginScreen();
        
        // Disconnect WebSocket if connected
        if (window.terminalManager) {
            window.terminalManager.disconnect();
        }
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('webTerminalToken');
    }

    onLoginSuccess() {
        this.hideError();
        this.showTerminalScreen();
        
        // Initialize terminal manager
        if (window.TerminalManager) {
            window.terminalManager = new window.TerminalManager(this.token);
        }
    }

    showLoginScreen() {
        this.setActiveScreen('login-screen');
    }

    showTerminalScreen() {
        this.setActiveScreen('terminal-screen');
    }

    showLoadingScreen() {
        this.setActiveScreen('loading-screen');
    }

    setActiveScreen(screenId) {
        const screens = document.querySelectorAll('.screen');
        screens.forEach(screen => screen.classList.remove('active'));
        
        const activeScreen = document.getElementById(screenId);
        if (activeScreen) {
            activeScreen.classList.add('active');
        }
    }

    setLoading(loading) {
        if (this.loginBtn) {
            this.loginBtn.disabled = loading;
            this.loginBtn.textContent = loading ? 'Logging in...' : 'Login';
        }
    }

    showError(message) {
        if (this.loginError) {
            this.loginError.textContent = message;
            this.loginError.classList.remove('hidden');
        }
    }

    hideError() {
        if (this.loginError) {
            this.loginError.classList.add('hidden');
        }
    }

    parseJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            
            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('Error parsing JWT:', error);
            return null;
        }
    }

    getToken() {
        return this.token;
    }

    getUser() {
        return this.user;
    }

    isAuthenticated() {
        return !!this.token && !!this.user;
    }

    // API helper method
    async apiRequest(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (response.status === 401) {
                // Token expired or invalid
                this.logout();
                throw new Error('Authentication required');
            }

            return response;
        } catch (error) {
            console.error('API request error:', error);
            throw error;
        }
    }
}

// Initialize auth manager when script loads
window.authManager = new AuthManager();