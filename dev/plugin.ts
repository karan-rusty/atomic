import { NotFoundExpection } from '@nextjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { HookManager, HookEvent } from '../hooks';
import type { LidMappingStore } from '../../engine/identity/lid-mapping-store.service';
import type { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { toNeutralJid } from '../../engine/identity/wa-id';
import { ConversationMappingConflict } from '../../modules/integration/conversation-mapping.service';
import { createLogger } from '../../common/service/logger.service';
import { isPluginActiveForSession, resolvePluginConfig } from './plugin-activation';
import { effectiveNetAllow, isNetHostAllowed, performPluginFetch } from './plugin-net';
import { buildConversationSendFacade, type ConversationMediaType } from './conversation-send-facade';
import { PluginHostServices } from './plugin-host-services';
import type { PluginMessagePort } from './plugin-host-ports';
import { PluginStorageService } from './plugin-storage.service';
import {
  PluginCapabilityError,
  PluginCapablilityPermission,
  type PluginContext, type PluginConversationsCapability,
} from './plugin.interfaces';

export function dispatchConversationMedia(
  svc: Pick<PluginMessagePort, 'sendImage' | 'sendVideo' | 'sendAudio' | 'sendDocument'>,
  sessionId: string,
  opts: { chatId: string; url: string; type: ConversationMediaType; caption?: string },
): Promise<unknown> {
  const dto = { chatId: opts.chatId, url: opts.url, caption: opts.caption };
  switch (opts.type) {
    case 'image':
      return svc.sendImage(sessionId, dto);
    case 'video':
      return svc.sendVideo(sessionId, dto);
    case 'audio':
      return svc.sendAudio(sessionId, dto);
    case 'voice':
      return svc.sendAudio(sessionId, { ...dto, ptt: true });
    case 'file':
      return svc.sendDocument(sessionId, dto);
  };
}

export class PluginCapabilityContext {
  private readonly hookSession = new AsyncLocalStorage<{ sessionId?: string }>();

  constructor(
    private readonly logger: ReturnType<typeof createLogger>,
    private readonly hostServices: PluginHostServices,
    private readonly hookManager: HookManager,
    private readonly pluginStorage: PluginStorageService,
    private readonly lidMappingStore?: LidMappingStore,
  ) { }

  private assertPermission(mainfest: PluginManifest, permission: PluginCapablilityPermission)
}
