// Script para verificar que la librería no hace ningún tipo de logging
import { LibreLinkClient } from './src/client.ts';

// Mock de console para detectar cualquier log
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
};

let consoleLogCalled = false;
let consoleErrorCalled = false;
let consoleWarnCalled = false;

console.log = (...args) => {
    consoleLogCalled = true;
    originalConsole.log('DETECTED console.log:', ...args);
};

console.error = (...args) => {
    consoleErrorCalled = true;
    originalConsole.error('DETECTED console.error:', ...args);
};

console.warn = (...args) => {
    consoleWarnCalled = true;
    originalConsole.warn('DETECTED console.warn:', ...args);
};

async function testNoConsoleLogs() {
    try {
        // Esto debería fallar sin hacer ningún tipo de logging
        const client = new LibreLinkClient({
            email: 'test@example.com',
            password: 'testpassword'
        });
        await client.login();
    } catch (error) {
        // Error esperado, pero NO debería haber console.logs
        originalConsole.log('✅ Error capturado correctamente (como se esperaba):', error.message);
    }

    // Verificar si se llamó a console
    if (consoleLogCalled || consoleErrorCalled || consoleWarnCalled) {
        originalConsole.error('❌ FALLO: La librería todavía está haciendo logs a la consola');
        originalConsole.log('console.log llamado:', consoleLogCalled);
        originalConsole.log('console.error llamado:', consoleErrorCalled);
        originalConsole.log('console.warn llamado:', consoleWarnCalled);
        process.exit(1);
    } else {
        originalConsole.log('✅ ÉXITO: La librería no hace logs a la consola');
        originalConsole.log('✅ ÉXITO: Método verbose y configuración eliminados correctamente');
    }

    // Restaurar console
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
}

testNoConsoleLogs();
