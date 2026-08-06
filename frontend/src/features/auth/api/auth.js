// src/features/auth/api/auth.js
import { apiClient } from "lib/apiClient";

export const login = (username, password) => 
  apiClient.post("/login", { username, password });

export const logout = () => 
  apiClient.post("/logout");

export const getMe = () => 
  apiClient.get("/me");

export const forceLogoutUser = (userId) => 
  apiClient.post(`/users/${userId}/force-logout`);

export const setUserLock = (id, lock) => 
  apiClient.patch(`/users/${id}/lock`, { lock: !!lock });