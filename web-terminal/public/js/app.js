class WebTerminalApp {
    constructor() {
        this.authManager = null;
        this.terminalManager = null;
        this.init();
    }

    init() {
        // Wait for DOM and all dependencies to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.onReady());
        } else {
            this.onReady();
        }
    }

    onReady() {
        console.log('Web Terminal App starting...');
        
        // Auth manager should already be initialized
        this.authManager = window.authManager;
        
        if (!this.authManager) {
            console.error('AuthManager not found');
            return;
        }

        // Setup global event handlers
        this.setupGlobalEvents();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        console.log('Web Terminal App ready');
    }

    setupGlobalEvents() {
        // Handle authentication state changes
        window.addEventListener('authStateChanged', (event) => {
            const { authenticated } = event.detail;
            
            if (authenticated) {
                this.onAuthenticated();
            } else {
                this.onUnauthenticated();
            }
        });

        // Handle window focus/blur for terminal management
        window.addEventListener('focus', () => {
            if (this.terminalManager && this.terminalManager.activeTerminalId) {
                const activeTerminal = this.terminalManager.terminals.get(
                    this.terminalManager.activeTerminalId
                );
                if (activeTerminal && activeTerminal.xterm) {
                    activeTerminal.xterm.focus();
                }
            }
        });

        // Handle beforeunload to warn about active terminals
        window.addEventListener('beforeunload', (event) => {
            if (this.terminalManager && this.terminalManager.terminals.size > 0) {
                const message = 'You have active terminal sessions. Are you sure you want to leave?';
                event.returnValue = message;
                return message;
            }
        });

        // Handle online/offline status
        window.addEventListener('online', () => {
            console.log('Connection restored');
            this.handleConnectionChange(true);
        });

        window.addEventListener('offline', () => {
            console.log('Connection lost');
            this.handleConnectionChange(false);
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Only handle shortcuts when not in an input field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }

            // Check for meta/ctrl combinations
            const isCtrlOrCmd = event.ctrlKey || event.metaKey;

            if (isCtrlOrCmd) {
                switch (event.code) {
                    case 'KeyT':
                        // Ctrl/Cmd + T: New terminal
                        event.preventDefault();
                        if (this.terminalManager) {
                            this.terminalManager.showNewTerminalDialog();
                        }
                        break;
                    
                    case 'KeyW':
                        // Ctrl/Cmd + W: Close current terminal
                        event.preventDefault();
                        if (this.terminalManager && this.terminalManager.activeTerminalId) {
                            this.terminalManager.closeTerminal(this.terminalManager.activeTerminalId);
                        }
                        break;
                    
                    case 'KeyL':
                        // Ctrl/Cmd + L: Clear terminal (let it pass through to terminal)
                        break;
                    
                    case 'KeyR':
                        // Ctrl/Cmd + R: Refresh (prevent default)
                        event.preventDefault();
                        this.refresh();
                        break;
                }
            }

            // Tab switching with Ctrl/Cmd + number
            if (isCtrlOrCmd && event.code >= 'Digit1' && event.code <= 'Digit9') {
                event.preventDefault();
                const tabIndex = parseInt(event.code.slice(-1)) - 1;
                this.switchToTab(tabIndex);
            }

            // Alt + Tab for terminal switching
            if (event.altKey && event.code === 'Tab') {
                event.preventDefault();
                this.switchToNextTerminal();
            }
        });

        // Handle escape key globally
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Escape') {
                // Close any open modals
                const openModals = document.querySelectorAll('.modal:not(.hidden)');
                openModals.forEach(modal => {
                    modal.classList.add('hidden');
                });
            }
        });
    }

    onAuthenticated() {
        console.log('User authenticated');
        // Terminal manager will be created by auth manager
    }

    onUnauthenticated() {
        console.log('User unauthenticated');
        if (this.terminalManager) {
            this.terminalManager.disconnect();
            this.terminalManager = null;
        }
    }

    handleConnectionChange(online) {
        if (online) {
            // Try to reconnect terminal manager
            if (this.terminalManager && !this.terminalManager.isConnected) {
                this.terminalManager.connect();
            }
        } else {
            // Show offline indicator
            if (this.terminalManager) {
                this.terminalManager.updateStatus('disconnected');
            }
        }
    }

    switchToTab(index) {
        if (this.terminalManager) {
            const terminalIds = Array.from(this.terminalManager.terminals.keys());
            if (index < terminalIds.length) {
                this.terminalManager.setActiveTerminal(terminalIds[index]);
            }
        }
    }

    switchToNextTerminal() {
        if (this.terminalManager) {
            const terminalIds = Array.from(this.terminalManager.terminals.keys());
            if (terminalIds.length <= 1) return;

            const currentIndex = terminalIds.indexOf(this.terminalManager.activeTerminalId);
            const nextIndex = (currentIndex + 1) % terminalIds.length;
            this.terminalManager.setActiveTerminal(terminalIds[nextIndex]);
        }
    }

    refresh() {
        // Soft refresh - reconnect WebSocket
        if (this.terminalManager) {
            this.terminalManager.connect();
        }
    }

    // Utility methods for other components to use
    showNotification(message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            padding: 1rem;
            border-radius: 4px;
            border: 1px solid var(--border-color);
            box-shadow: var(--shadow);
            z-index: 10000;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        });

        // Auto remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // Debug methods
    getDebugInfo() {
        return {
            authenticated: this.authManager?.isAuthenticated(),
            user: this.authManager?.getUser(),
            connected: this.terminalManager?.isConnected,
            terminals: this.terminalManager?.terminals.size || 0,
            activeTerminal: this.terminalManager?.activeTerminalId
        };
    }
}

// Initialize the app when script loads
const app = new WebTerminalApp();

// Make app available globally for debugging
window.webTerminalApp = app;

// Add some helpful global functions for development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.debugTerminal = () => {
        console.log('Debug Info:', app.getDebugInfo());
        return app.getDebugInfo();
    };
}