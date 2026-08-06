// src/features/analysis/api/analysis.js
import { apiClient } from "lib/apiClient";

export const getConversationInfo = (userId, convId) => 
  apiClient.get(`/users/${userId}/conversations/${convId}/info-tables`);

export const addConversationInfo = (userId, convId, payload) => 
  apiClient.post(`/users/${userId}/conversations/${convId}/info-tables`, payload);

export const deleteConversationInfo = (userId, convId, infoId) => 
  apiClient.delete(`/users/${userId}/conversations/${convId}/info-tables/${infoId}`);

export const updateConversationInfo = (userId, convId, infoId, updates) => 
  apiClient.patch(`/users/${userId}/conversations/${convId}/info-tables/${infoId}`, updates);