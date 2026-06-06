import { useCallback } from "react";

export interface WorkspaceSwitchOptions {
  onClearMessages: () => void;
  onClearSession: () => void;
  onProfileChanged: (profileName: string) => void;
}

/**
 * Session Controller: gerencia troca segura de workspace.
 * 1. Aborta chat em andamento
 * 2. Limpa mensagens e sessionId
 * 3. Atualiza firewall no main process
 * 4. Ativa o perfil no backend hermes
 * 5. Notifica o layout
 */
export function useWorkspaceSwitch({
  onClearMessages,
  onClearSession,
  onProfileChanged,
}: WorkspaceSwitchOptions) {
  const switchWorkspace = useCallback(
    async (profileName: string) => {
      try {
        await window.hermesAPI.abortChat();
      } catch { /* ignora se não havia chat */ }

      onClearMessages();
      onClearSession();

      await window.hermesAPI.setActiveWorkspaceFirewall(profileName);
      await window.hermesAPI.setActiveProfile(profileName);

      onProfileChanged(profileName);
    },
    [onClearMessages, onClearSession, onProfileChanged],
  );

  return { switchWorkspace };
}
