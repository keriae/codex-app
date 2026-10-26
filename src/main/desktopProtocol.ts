export const DESKTOP_CLIENT_VERSION = '26.1016.61520'
export const DESKTOP_INITIALIZE_ID = '__codex_initialize__'

// Observed desktop opt-outs, except command output: the editable replica uses
// the server PTY stream in place of the original proprietary native channel.
export const DESKTOP_OPT_OUT_NOTIFICATION_METHODS = [
  'thread/readState/changed',
  'thread/project/updated',
  'thread/prediction/updated',
  'rawResponseItem/completed',
  'project/changed',
  'externalAgentConfig/import/progress',
  'thread/compacted',
  'windows/worldWritableWarning',
  'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted',
  'authStatusChange',
  'loginChatGptComplete',
  'codex/event/task_started',
  'codex/event/agent_reasoning',
  'codex/event/agent_message',
  'codex/event/task_complete',
  'codex/event/mcp_tool_call_begin',
  'codex/event/mcp_tool_call_end',
  'codex/event/exec_command_begin',
  'codex/event/exec_command_end',
  'codex/event/exec_command_output_delta',
  'codex/event/exec_approval_request',
  'codex/event/apply_patch_approval_request',
  'codex/event/background_event',
  'codex/event/turn_diff',
  'codex/event/get_history_entry_response',
  'codex/event/agent_reasoning_delta',
  'codex/event/agent_reasoning_section_break',
  'codex/event/agent_message_delta',
  'codex/event/stream_error',
  'codex/event/error',
  'codex/event/turn_aborted',
  'codex/event/plan_delta',
  'codex/event/plan_update',
  'codex/event/patch_apply_begin',
  'codex/event/patch_apply_end',
  'codex/event/item_started',
  'codex/event/item_completed',
  'codex/event/user_message',
  'codex/event/agent_reasoning_raw_content',
  'codex/event/agent_reasoning_raw_content_delta',
  'codex/event/web_search_begin',
  'codex/event/web_search_end',
  'codex/event/mcp_list_tools_response',
  'codex/event/list_skills_response',
  'codex/event/list_remote_skills_response',
  'codex/event/remote_skill_downloaded',
  'codex/event/list_custom_prompts_response',
  'codex/event/raw_response_item',
  'codex/event/agent_message_content_delta',
  'codex/event/reasoning_content_delta',
  'codex/event/reasoning_raw_content_delta',
  'codex/event/warning',
  'codex/event/undo_started',
  'codex/event/undo_completed',
  'codex/event/shutdown_complete',
  'codex/event/entered_review_mode',
  'codex/event/exited_review_mode',
  'codex/event/view_image_tool_call',
  'codex/event/mcp_startup_update',
  'codex/event/mcp_startup_complete',
  'codex/event/remote_task_created',
  'codex/event/thread_rolled_back',
  'codex/event/thread_name_updated',
  'codex/event/elicitation_request',
  'codex/event/dynamic_tool_call_request',
  'codex/event/request_user_input',
  'codex/event/terminal_interaction',
  'codex/event/token_count',
  'codex/event/deprecation_notice',
  'thread/closed',
  'thread/reverted',
  'rawResponse/completed',
  'warning',
  'turn/diff/updated'
]

export const DESKTOP_INITIALIZE_PARAMS = {
  clientInfo: {
    name: 'Codex Desktop',
    title: 'Codex Desktop',
    version: DESKTOP_CLIENT_VERSION
  },
  capabilities: {
    explicitGatewayOauth: true,
    experimentalApi: true,
    extensions: {
      'io.modelcontextprotocol/ui': {
        mimeTypes: ['text/html;profile=mcp-app', 'text/html+skybridge']
      },
      'openai/elicitation': {
        form: {}
      }
    },
    mcpServerOpenaiFormElicitation: true,
    // The upstream desktop can mint a platform attestation token. This clone
    // must not advertise that capability until it has an equivalent provider.
    requestAttestation: false,
    optOutNotificationMethods: DESKTOP_OPT_OUT_NOTIFICATION_METHODS
  }
}
