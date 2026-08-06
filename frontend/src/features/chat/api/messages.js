// src/features/chat/api/messages.js
import { apiClient } from "lib/apiClient";

/* ========================================================================
   CONVERSATION MANAGEMENT (CRUD)
   ======================================================================== */

export const listConversations = (userId) => 
  apiClient.get(`/users/${userId}/conversations`);

export const getConversation = (userId, convId) => 
  apiClient.get(`/users/${userId}/conversations/${convId}`);

export const getConversationMessages = (userId, convId) => 
  apiClient.get(`/users/${userId}/conversations/${convId}/data-source`);

export const createConversation = (userId, data) => 
  apiClient.post(`/users/${userId}/conversations`, data);

export const deleteConversation = (userId, convId) => 
  apiClient.delete(`/users/${userId}/conversations/${convId}`);

export const renameConversation = (userId, convId, name) => 
  apiClient.patch(`/users/${userId}/conversations/${convId}/rename`, { name });

export const initialSummaryConversation = (userId, convId, summary) => 
  apiClient.patch(`/users/${userId}/conversations/${convId}/initial-summary`, { summary });

export const appendConversationMessage = (userId, convId, payload) => 
  apiClient.patch(`/users/${userId}/conversations/${convId}/messages`, payload);