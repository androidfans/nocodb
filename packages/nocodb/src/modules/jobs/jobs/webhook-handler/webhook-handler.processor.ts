import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { invokeWebhook } from '~/helpers/webhookHelpers';
import { Hook, Model, View } from '~/models';
import { type HandleWebhookJobData } from '~/interface/Jobs';
import { IJobsService } from '~/modules/jobs/jobs-service.interface';

// Temporary troubleshooting switch.
// Remove all nc-webhook-trace instrumentation after root-cause is fixed.
const webhookTraceEnabled = ['1', 'true', 'yes', 'on'].includes(
  (process.env.NC_WEBHOOK_TRACE || '').toLowerCase(),
);

export class WebhookHandlerProcessor {
  protected logger = new Logger(WebhookHandlerProcessor.name);

  private trace(event: string, meta: Record<string, unknown>) {
    if (!webhookTraceEnabled) return;

    this.logger.warn(`[nc-webhook-trace][job] ${event} ${JSON.stringify(meta)}`);
  }

  constructor(
    @Inject('JobsService') private readonly jobsService: IJobsService,
  ) {}

  async job(job: Job<HandleWebhookJobData>) {
    const {
      context,
      hookId,
      modelId,
      viewId,
      prevData,
      newData,
      user,
      hookName,
      ncSiteUrl,
    } = job.data;

    this.trace('start', {
      jobId: job.id,
      hookId,
      modelId,
      viewId: viewId ?? null,
      hookName,
    });

    const hook = await Hook.get(context, hookId);
    if (!hook) {
      this.logger.error(`Hook not found for id: ${hookId}`);
      this.trace('skip-hook-not-found', {
        jobId: job.id,
        hookId,
        hookName,
      });
      return;
    }

    const model = await Model.get(context, modelId);
    if (!model) {
      this.logger.error(`Model not found for id: ${modelId}`);
      this.trace('skip-model-not-found', {
        jobId: job.id,
        hookId,
        modelId,
        hookName,
      });
      return;
    }

    const view = viewId ? await View.get(context, viewId) : null;

    await invokeWebhook(context, {
      hook,
      model,
      view,
      prevData,
      newData,
      user,
      hookName,
      ncSiteUrl,
      addJob: this.jobsService.add.bind(this.jobsService),
    });

    this.trace('done', {
      jobId: job.id,
      hookId,
      modelId,
      viewId: viewId ?? null,
      hookName,
    });
  }
}
