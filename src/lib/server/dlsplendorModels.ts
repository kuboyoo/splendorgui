import path from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export interface DlsplendorModelDefinition {
  id: string;
  kind: 'checkpoint' | 'rule';
  family: string;
  iteration: number;
  label: string;
  note: string;
  recommended: boolean;
  relativePath?: string;
  configRelativePath?: string;
}

export interface DlsplendorModelOption {
  id: string;
  kind: 'checkpoint' | 'rule';
  family: string;
  iteration: number;
  label: string;
  note: string;
  recommended: boolean;
  available: boolean;
}

const SELFPLAY5_ITERATIONS = [139, 203, 380, 577, 824, 998] as const;

const SELFPLAY5_NOTES: Record<(typeof SELFPLAY5_ITERATIONS)[number], string> = {
  139: '初期比較の基準モデル',
  203: '139比 約+37 Elo',
  380: '139比 約+85 Elo',
  577: '139比 約+171 Elo',
  824: '139比 約+198 Elo',
  998: '824に107勝91敗2分',
};

const SELFPLAY10_MODEL: DlsplendorModelDefinition = {
  id: 'selfplay10-best',
  kind: 'checkpoint',
  family: 'selfplay10',
  iteration: 7,
  label: 'selfplay10 best（iteration 000007）',
  note: '公開山札確率・3手購入経路・妨害候補を学習',
  recommended: true,
  relativePath: path.join('models', 'selfplay10', 'best.pt'),
  configRelativePath: path.join('configs', 'selfplay10.yaml'),
};

const SELFPLAY9_MODEL: DlsplendorModelDefinition = {
  id: 'selfplay9-best',
  kind: 'checkpoint',
  family: 'selfplay9',
  iteration: 12,
  label: 'selfplay9 best（iteration 000012）',
  note: 'selfplay8 best比 推定+63 Elo',
  recommended: false,
  relativePath: path.join('models', 'selfplay9', 'best.pt'),
  configRelativePath: path.join('configs', 'selfplay9.yaml'),
};

const SELFPLAY8_MODEL: DlsplendorModelDefinition = {
  id: 'selfplay8-best',
  kind: 'checkpoint',
  family: 'selfplay8',
  iteration: 8,
  label: 'selfplay8 best（iteration 000008）',
  note: 'Gold橋渡し予約を強化',
  recommended: false,
  relativePath: path.join('models', 'selfplay8', 'best.pt'),
  configRelativePath: path.join('configs', 'selfplay8.yaml'),
};

const SELFPLAY7_MODEL: DlsplendorModelDefinition = {
  id: 'selfplay7-iteration-000030',
  kind: 'checkpoint',
  family: 'selfplay7',
  iteration: 30,
  label: 'selfplay7 iteration 000030',
  note: 'multi-head pilot 30 iteration',
  recommended: false,
  relativePath: path.join(
    'models',
    'selfplay7',
    'weights',
    'iteration_000030.pt',
  ),
  configRelativePath: path.join('configs', 'selfplay7.yaml'),
};

const COST_EFFICIENCY_RULE: DlsplendorModelDefinition = {
  id: 'rule-cost-efficiency-3ply',
  kind: 'rule',
  family: 'rule',
  iteration: 0,
  label: 'ルールAI（3手・得点効率）',
  note: '3手以内の購入候補を得点÷支払い枚数で選択',
  recommended: false,
};

const SELFPLAY5_MODELS: readonly DlsplendorModelDefinition[] =
  SELFPLAY5_ITERATIONS.map((iteration) => {
    const padded = String(iteration).padStart(6, '0');
    return {
      id: `selfplay5-iteration-${padded}`,
      kind: 'checkpoint',
      family: 'selfplay5',
      iteration,
      label: `selfplay5 iteration ${padded}`,
      note: SELFPLAY5_NOTES[iteration],
      recommended: false,
      relativePath: path.join(
        'models',
        'selfplay5',
        'weights',
        `iteration_${padded}.pt`,
      ),
    };
  });

export const DLSPLENDOR_MODELS: readonly DlsplendorModelDefinition[] = [
  SELFPLAY10_MODEL,
  SELFPLAY9_MODEL,
  SELFPLAY8_MODEL,
  SELFPLAY7_MODEL,
  COST_EFFICIENCY_RULE,
  ...SELFPLAY5_MODELS,
];

export function getDlsplendorRoot(): string {
  const configured = process.env.DLSPLENDOR_ROOT?.trim();
  return path.resolve(configured || path.join(process.cwd(), '..', 'dlsplendor'));
}

export async function listDlsplendorModels(): Promise<DlsplendorModelOption[]> {
  const root = getDlsplendorRoot();
  return Promise.all(
    DLSPLENDOR_MODELS.map(async (model) => {
      let available = model.kind === 'rule';
      if (model.kind === 'checkpoint' && model.relativePath) {
        try {
          await access(path.join(root, model.relativePath), constants.R_OK);
          if (model.configRelativePath) {
            await access(
              path.join(root, model.configRelativePath),
              constants.R_OK,
            );
          }
          available = true;
        } catch {
          available = false;
        }
      }
      return {
        id: model.id,
        kind: model.kind,
        family: model.family,
        iteration: model.iteration,
        label: model.label,
        note: model.note,
        recommended: model.recommended,
        available,
      };
    }),
  );
}

export async function resolveDlsplendorModel(
  modelId: string,
): Promise<
  DlsplendorModelDefinition & {
    absolutePath: string | null;
    configAbsolutePath: string | null;
  }
> {
  const model = DLSPLENDOR_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error('指定されたモデルは選択できません。');
  }

  const root = getDlsplendorRoot();
  if (model.kind === 'rule') {
    return { ...model, absolutePath: null, configAbsolutePath: null };
  }
  if (!model.relativePath) {
    throw new Error(`モデルファイルが未設定です: ${model.label}`);
  }
  const absolutePath = path.join(root, model.relativePath);
  const configAbsolutePath = model.configRelativePath
    ? path.join(root, model.configRelativePath)
    : null;
  try {
    await access(absolutePath, constants.R_OK);
    if (configAbsolutePath) {
      await access(configAbsolutePath, constants.R_OK);
    }
  } catch {
    throw new Error(`モデルまたは設定ファイルを読み込めません: ${model.label}`);
  }
  return { ...model, absolutePath, configAbsolutePath };
}
