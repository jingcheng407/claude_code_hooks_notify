class TerminalManager {
    constructor(token) {
        this.token = token;
        this.socket = null;
        this.terminals = new Map();
        this.activeTerminalId = null;
        this.isConnected = false;
        
        this.setupUI();
        this.connect();
    }

    setupUI() {
        // Terminal tabs container
        this.tabsContainer = document.getElementById('terminal-tabs-container');
        this.terminalContainer = document.getElementById('terminal-container');
        this.statusIndicator = document.getElementById('connection-status');
        this.terminalInfo = document.getElementById('terminal-info');
        
        // Buttons
        const newTerminalBtn = document.getElementById('new-terminal-btn');
        if (newTerminalBtn) {
            newTerminalBtn.addEventListener('click', () => this.showNewTerminalDialog());
        }

        // Theme selector
        const themeSelector = document.getElementById('theme-selector');
        if (themeSelector) {
            themeSelector.addEventListener('change', (e) => this.changeTheme(e.target.value));
            // Load saved theme
            const savedTheme = localStorage.getItem('webTerminalTheme') || 'dark';
            themeSelector.value = savedTheme;
            this.changeTheme(savedTheme);
        }

        // Setup modals
        this.setupModals();
    }

    setupModals() {
        // Settings modal
        this.settingsModal = document.getElementById('settings-modal');
        this.errorModal = document.getElementById('error-modal');

        // Modal close buttons
        const modalCloses = document.querySelectorAll('.modal-close');
        modalCloses.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.hideModal(modal);
                }
            });
        });

        // Settings modal buttons
        const settingsCancel = document.getElementById('settings-cancel');
        const settingsCreate = document.getElementById('settings-create');
        
        if (settingsCancel) {
            settingsCancel.addEventListener('click', () => this.hideModal(this.settingsModal));
        }
        
        if (settingsCreate) {
            settingsCreate.addEventListener('click', () => this.createTerminalFromSettings());
        }

        // Error modal OK button
        const errorOk = document.getElementById('error-ok');
        if (errorOk) {
            errorOk.addEventListener('click', () => this.hideModal(this.errorModal));
        }

        // Click outside to close
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideModal(e.target);
            }
        });
    }

    connect() {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.updateStatus('connecting');
        
        this.socket = io({
            auth: {
                token: this.token
            }
        });

        this.socket.on('connect', () => {
            console.log('Connected to WebSocket');
            this.isConnected = true;
            this.updateStatus('connected');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from WebSocket:', reason);
            this.isConnected = false;
            this.updateStatus('disconnected');
        });

        this.socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            this.isConnected = false;
            this.updateStatus('error');
            this.showError('Failed to connect to terminal server');
        });

        this.socket.on('authenticated', (data) => {
            console.log('Authenticated:', data);
            this.updateInfo('Connected successfully');
        });

        // Terminal events
        this.socket.on('terminal:created', (data) => this.onTerminalCreated(data));
        this.socket.on('terminal:data', (data) => this.onTerminalData(data));
        this.socket.on('terminal:exit', (data) => this.onTerminalExit(data));
        this.socket.on('terminal:error', (data) => this.onTerminalError(data));
        this.socket.on('terminal:killed', (data) => this.onTerminalKilled(data));
        this.socket.on('terminal:resized', (data) => this.onTerminalResized(data));
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        // Clean up terminals
        this.terminals.forEach(terminal => {
            if (terminal.xterm) {
                terminal.xterm.dispose();
            }
        });
        this.terminals.clear();
        
        // Clear UI
        if (this.tabsContainer) {
            this.tabsContainer.innerHTML = '';
        }
        if (this.terminalContainer) {
            this.terminalContainer.innerHTML = '';
        }
    }

    showNewTerminalDialog() {
        if (this.settingsModal) {
            this.showModal(this.settingsModal);
        }
    }

    createTerminalFromSettings() {
        const cols = parseInt(document.getElementById('terminal-cols').value) || 80;
        const rows = parseInt(document.getElementById('terminal-rows').value) || 24;
        const shell = document.getElementById('terminal-shell').value || '/bin/bash';

        this.createTerminal({
            cols,
            rows,
            shell
        });

        this.hideModal(this.settingsModal);
    }

    createTerminal(options = {}) {
        if (!this.isConnected) {
            this.showError('Not connected to terminal server');
            return;
        }

        const terminalOptions = {
            cols: options.cols || 80,
            rows: options.rows || 24,
            shell: options.shell || '/bin/bash',
            cwd: options.cwd
        };

        this.socket.emit('terminal:create', terminalOptions);
        this.updateInfo('Creating terminal...');
    }

    onTerminalCreated(data) {
        const { terminalId, pid } = data;
        
        // Create xterm instance
        const xterm = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Mono", monospace',
            theme: this.getCurrentTerminalTheme(),
            allowTransparency: true
        });

        // Add addons
        const fitAddon = new FitAddon.FitAddon();
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
        
        xterm.loadAddon(fitAddon);
        xterm.loadAddon(webLinksAddon);

        // Create terminal instance
        const terminalInstance = {
            id: terminalId,
            pid,
            xterm,
            fitAddon,
            element: null
        };

        // Create UI elements
        this.createTerminalUI(terminalInstance);
        
        // Store terminal
        this.terminals.set(terminalId, terminalInstance);
        
        // Set as active if it's the first terminal
        if (this.terminals.size === 1) {
            this.setActiveTerminal(terminalId);
        }

        // Setup input handling
        xterm.onData(data => {
            if (this.isConnected) {
                this.socket.emit('terminal:input', {
                    terminalId,
                    input: data
                });
            }
        });

        // Setup resize handling
        xterm.onResize(({ cols, rows }) => {
            if (this.isConnected) {
                this.socket.emit('terminal:resize', {
                    terminalId,
                    cols,
                    rows
                });
            }
        });

        this.updateInfo(`Terminal ${terminalId.substr(0, 8)} created (PID: ${pid})`);
    }

    createTerminalUI(terminal) {
        const { id, xterm } = terminal;

        // Create tab
        const tab = document.createElement('div');
        tab.className = 'terminal-tab';
        tab.innerHTML = `
            <span class="tab-title">Terminal ${id.substr(0, 8)}</span>
            <button class="tab-close" title="Close terminal">&times;</button>
        `;
        
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                this.setActiveTerminal(id);
            }
        });

        const closeBtn = tab.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTerminal(id);
        });

        this.tabsContainer.appendChild(tab);

        // Create terminal element
        const terminalElement = document.createElement('div');
        terminalElement.className = 'terminal-instance';
        terminalElement.id = `terminal-${id}`;
        
        this.terminalContainer.appendChild(terminalElement);

        // Open xterm in the element
        xterm.open(terminalElement);
        
        // Store references
        terminal.element = terminalElement;
        terminal.tab = tab;

        // Fit terminal to container
        setTimeout(() => {
            terminal.fitAddon.fit();
        }, 100);

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.activeTerminalId === id) {
                terminal.fitAddon.fit();
            }
        });
    }

    setActiveTerminal(terminalId) {
        // Remove active class from all terminals and tabs
        this.terminals.forEach((terminal, id) => {
            terminal.element.classList.remove('active');
            terminal.tab.classList.remove('active');
        });

        // Set new active terminal
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.element.classList.add('active');
            terminal.tab.classList.add('active');
            this.activeTerminalId = terminalId;
            
            // Fit terminal when becoming active
            setTimeout(() => {
                terminal.fitAddon.fit();
                terminal.xterm.focus();
            }, 50);
        }
    }

    closeTerminal(terminalId) {
        if (this.isConnected) {
            this.socket.emit('terminal:kill', { terminalId });
        } else {
            this.removeTerminalUI(terminalId);
        }
    }

    onTerminalData(data) {
        if (data && data.data) {
            const activeTerminal = this.terminals.get(this.activeTerminalId);
            if (activeTerminal && activeTerminal.xterm) {
                activeTerminal.xterm.write(data.data);
            }
        }
    }

    onTerminalExit(data) {
        const { code, signal } = data;
        this.updateInfo(`Terminal exited (code: ${code}, signal: ${signal})`);
    }

    onTerminalKilled(data) {
        const { terminalId } = data;
        this.removeTerminalUI(terminalId);
        this.updateInfo(`Terminal ${terminalId.substr(0, 8)} closed`);
    }

    onTerminalResized(data) {
        const { terminalId, cols, rows } = data;
        this.updateInfo(`Terminal ${terminalId.substr(0, 8)} resized to ${cols}x${rows}`);
    }

    onTerminalError(data) {
        this.showError(data.message || 'Terminal error occurred');
    }

    removeTerminalUI(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            // Dispose of xterm
            if (terminal.xterm) {
                terminal.xterm.dispose();
            }
            
            // Remove UI elements
            if (terminal.element) {
                terminal.element.remove();
            }
            if (terminal.tab) {
                terminal.tab.remove();
            }
            
            // Remove from map
            this.terminals.delete(terminalId);
            
            // Set new active terminal if this was active
            if (this.activeTerminalId === terminalId) {
                const remainingTerminals = Array.from(this.terminals.keys());
                if (remainingTerminals.length > 0) {
                    this.setActiveTerminal(remainingTerminals[0]);
                } else {
                    this.activeTerminalId = null;
                }
            }
        }
    }

    changeTheme(theme) {
        // Update body class
        document.body.className = `${theme}-theme`;
        
        // Save theme preference
        localStorage.setItem('webTerminalTheme', theme);
        
        // Update terminal themes
        const terminalTheme = this.getCurrentTerminalTheme();
        this.terminals.forEach(terminal => {
            if (terminal.xterm) {
                terminal.xterm.options.theme = terminalTheme;
            }
        });
    }

    getCurrentTerminalTheme() {
        const theme = localStorage.getItem('webTerminalTheme') || 'dark';
        
        const themes = {
            dark: {
                background: '#1e1e1e',
                foreground: '#cccccc',
                cursor: '#cccccc',
                selection: '#264f78'
            },
            light: {
                background: '#ffffff',
                foreground: '#333333',
                cursor: '#333333',
                selection: '#add6ff'
            },
            'high-contrast': {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffff00',
                selection: '#ffffff'
            }
        };
        
        return themes[theme] || themes.dark;
    }

    updateStatus(status) {
        if (!this.statusIndicator) return;
        
        this.statusIndicator.className = 'status-indicator';
        
        switch (status) {
            case 'connected':
                this.statusIndicator.classList.add('connected');
                break;
            case 'disconnected':
            case 'error':
                this.statusIndicator.classList.add('disconnected');
                break;
        }
    }

    updateInfo(message) {
        if (this.terminalInfo) {
            this.terminalInfo.textContent = message;
        }
    }

    showModal(modal) {
        modal.classList.remove('hidden');
    }

    hideModal(modal) {
        modal.classList.add('hidden');
    }

    showError(message) {
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
        this.showModal(this.errorModal);
    }
}

// Make TerminalManager available globally
window.TerminalManager = TerminalManager;