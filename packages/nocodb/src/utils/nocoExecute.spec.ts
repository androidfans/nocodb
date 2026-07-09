import { UITypes } from 'nocodb-sdk';
import { nocoExecute, type ResolverObj } from './nocoExecute';

const withColumnAliases = (
  data: Record<string, any>,
  aliases: NonNullable<ResolverObj['__proto__']>['__columnAliases'],
) => Object.assign(Object.create({ __columnAliases: aliases }), data);

describe('nocoExecute', () => {
  it('normalizes nested lookup aliases that resolve to a multiselect column', async () => {
    const sourceVideo = {
      video_category: 'Short,Live',
    };
    const sourceVariationScript = withColumnAliases(
      {
        source_video: sourceVideo,
      },
      {
        script_category: {
          path: ['source_video', 'video_category'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );
    const row = withColumnAliases(
      {
        source_variation_script: sourceVariationScript,
      },
      {
        source_video_category: {
          path: ['source_variation_script', 'script_category'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );

    await expect(
      nocoExecute({ source_video_category: 1 }, row),
    ).resolves.toEqual({
      source_video_category: ['Short', 'Live'],
    });
  });

  it('flattens JSON aggregated multiselect lookup values', async () => {
    const row = withColumnAliases(
      {
        source_videos: [
          {
            video_category: '["Short,Live","Ad"]',
          },
        ],
      },
      {
        source_video_category: {
          path: ['source_videos', 'video_category'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );

    await expect(
      nocoExecute({ source_video_category: 1 }, row),
    ).resolves.toEqual({
      source_video_category: ['Short', 'Live', 'Ad'],
    });
  });
});
