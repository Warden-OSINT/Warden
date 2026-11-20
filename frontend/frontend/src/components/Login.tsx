import React, { useState } from "react";
import type { ChangeEvent } from "react";
import type { LoginCredentials, LoginError } from "../types/auth";
import { authService } from "../services/authService";
import styles from './Login.module.css';

interface LoginProps {
    onSuccess?: (token: string) => void;
}

const Login: React.FC<LoginProps> = ({ onSuccess }) => {
    const [credentials, setCredentials] = useState<LoginCredentials>({
        email: '',
        password: '',
    });
    const [error, setError] = useState<LoginError | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const {name, value} = e.target;
        setCredentials((prev) => ({ ...prev, [name]: value}));
        if (error?.field === name) setError(null);
    };

    const validate = (): boolean => {
        if (!credentials.email.trim()){
            setError({ field:'email', message: 'El email es obligatorio'});
            return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email)) {
            setError({ field:'email', message:'Email inválido'});
            return false;
        }
        if (credentials.password.length < 6){
            setError({
                field: 'password',
                message: 'La contraseña debe de tener al menos 6 caracteres',
            });
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        setError(null);

        if (!validate()) return;

        setIsLoading(true);
        try{
            const response = await authService.login(credentials);
            localStorage.setItem('token',response.token);
            onSuccess?.(response.token);
            console.log('login exitoso:',response.user);
        } catch(err) {
            const message = err instanceof Error ? err.message : 'Error desconocido';
            setError({ field:'general',message});
        } finally {
            setIsLoading(false);
        }
    };

    return (
        
        <div className={styles.container}>
            <h1 className={styles.title}> Inicio de Sesión </h1>
            <form onSubmit={handleSubmit} className={styles.form} noValidate>

                {error?.field === 'general' && (
                    <div className={styles.errorBox}>{error.message}</div>
                )}

                <div className={styles.field}>
                    <label htmlFor="email" className={styles.label}>
                        Usuario
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        value={credentials.email}
                        onChange={handleChange}
                        placeholder="tu@email.com"
                        className={`${styles.input} ${
                            error?.field === 'email' ? styles.inputError : ''
                        }`}
                        disabled={isLoading}
                        autoComplete="email"
                    />
                    {error?.field === 'email' && (
                        <span className={styles.errorText}>{error.message}</span>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor="password" className={styles.label}>
                        Contraseña
                    </label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        value={credentials.password}
                        onChange={handleChange}
                        placeholder="******"
                        className={`${styles.input} ${
                            error?.field === 'password' ? styles.inputError : ''
                        }`}
                        disabled={isLoading}
                        autoComplete="current-password"
                    />
                    {error?.field === 'password' && (
                        <span className={styles.errorText}>{error.message}</span>
                    )}
                </div>

                <button type="submit" disabled={isLoading} className={styles.button}>
                    {isLoading ? 'Ingresando...' : 'Iniciar Sesión'}
                </button>

                <p className={styles.hint}>
                    Demo: admin@test.com / 123456
                </p>
                
            </form>
        </div>
    );
};

export default Login;