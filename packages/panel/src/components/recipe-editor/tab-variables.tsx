import { Plus } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Switch } from '~/components/ui/switch';
import { Textarea } from '~/components/ui/textarea';
import { CollapseCard, FieldShell, ItemActions, TagsInput } from './fields';
import type { RecipeForm } from './recipe-editor';
import { newVariableValue, type RecipeVariableValue } from '~/validators/recipe-editor';

/**
 * Tab « Variables » — Pelican's Egg Variables tab: collapsible cards
 * (collapsed by default, item label in the header), one add button.
 * The env name auto-derives from the label while not manually set
 * (same behaviour as Pelican's snake/upper casing).
 */

/**
 * Typed deep field names for `variables[i]` — the `as const` keeps the
 * template literal types required by TanStack Form's DeepKeys (plain
 * template expressions widen to `string`).
 */
function variableNames(index: number) {
  return {
    name: `variables[${index}].name` as const,
    env: `variables[${index}].env` as const,
    type: `variables[${index}].type` as const,
    defaultValue: `variables[${index}].defaultValue` as const,
    description: `variables[${index}].description` as const,
    min: `variables[${index}].min` as const,
    max: `variables[${index}].max` as const,
    pattern: `variables[${index}].pattern` as const,
    options: `variables[${index}].options` as const,
    sort: `variables[${index}].sort` as const,
    userViewable: `variables[${index}].userViewable` as const,
    userEditable: `variables[${index}].userEditable` as const,
    required: `variables[${index}].required` as const,
  };
}

/** label → UPPERCASE_SNAKE env name (accent-insensitive, like Pelican). */
function deriveEnv(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

/** defaultValue type conversion when the variable type changes. */
function convertDefault(
  current: string | number | boolean,
  type: RecipeVariableValue['type'],
): string | number | boolean {
  if (type === 'number') return Number(current) || 0;
  if (type === 'boolean') return current === true || current === 'true' || current === 1;
  return String(current);
}

export function VariablesTab({ form }: { form: RecipeForm }) {
  return (
    <form.Field name="variables">
      {(field) => (
        <div className="space-y-3">
          {field.state.value.map((variable, index) => (
            <VariableCard
              key={index}
              form={form}
              index={index}
              onMoveUp={index > 0 ? () => field.moveValue(index, index - 1) : undefined}
              onMoveDown={
                index < field.state.value.length - 1
                  ? () => field.moveValue(index, index + 1)
                  : undefined
              }
              onRemove={() => field.removeValue(index)}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={() => field.pushValue(newVariableValue(field.state.value.length))}
          >
            <Plus />
            Ajouter une variable
          </Button>
        </div>
      )}
    </form.Field>
  );
}

function VariableCard({
  form,
  index,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  form: RecipeForm;
  index: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  const v = variableNames(index);

  return (
    <form.Subscribe selector={(s) => s.values.variables[index]}>
      {(variable) => (
        <CollapseCard
          title={variable?.name || 'Nouvelle variable'}
          subtitle={variable?.env ? `{{${variable.env}}}` : undefined}
          actions={
            <ItemActions onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <form.Field name={v.name}>
              {(nameField) => (
                <FieldShell
                  id={`variable-${index}-name`}
                  label="Nom"
                  errors={nameField.state.meta.errors}
                >
                  <Input
                    id={`variable-${index}-name`}
                    value={nameField.state.value}
                    onChange={(e) => {
                      const next = e.target.value;
                      nameField.handleChange(next);
                      // Auto-derive the env name while it has not been set manually
                      if (!variable?.env) {
                        form.setFieldValue(v.env, deriveEnv(next));
                      }
                    }}
                    onBlur={nameField.handleBlur}
                  />
                </FieldShell>
              )}
            </form.Field>

            <form.Field name={v.env}>
              {(envField) => (
                <FieldShell
                  id={`variable-${index}-env`}
                  label="Variable d'environnement"
                  hint={`S'utilise dans les templates : {{${envField.state.value || '…'}}}`}
                  errors={envField.state.meta.errors}
                >
                  <Input
                    id={`variable-${index}-env`}
                    className="font-mono uppercase"
                    value={envField.state.value}
                    onChange={(e) => envField.handleChange(e.target.value.toUpperCase())}
                    onBlur={envField.handleBlur}
                    placeholder="MINECRAFT_VERSION"
                  />
                </FieldShell>
              )}
            </form.Field>

            <form.Field name={v.type}>
              {(typeField) => (
                <FieldShell
                  id={`variable-${index}-type`}
                  label="Type"
                  errors={typeField.state.meta.errors}
                >
                  <Select
                    value={typeField.state.value}
                    onValueChange={(type) => {
                      const nextType = type as RecipeVariableValue['type'];
                      typeField.handleChange(nextType);
                      form.setFieldValue(
                        v.defaultValue,
                        convertDefault(variable?.defaultValue ?? '', nextType),
                      );
                    }}
                  >
                    <SelectTrigger id={`variable-${index}-type`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">Chaîne</SelectItem>
                      <SelectItem value="number">Nombre</SelectItem>
                      <SelectItem value="boolean">Booléen</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldShell>
              )}
            </form.Field>

            <form.Field name={v.defaultValue}>
              {(defaultField) => (
                <FieldShell
                  id={`variable-${index}-default`}
                  label="Valeur par défaut"
                  errors={defaultField.state.meta.errors}
                >
                  {variable?.type === 'boolean' ? (
                    <Select
                      value={String(defaultField.state.value)}
                      onValueChange={(value) => defaultField.handleChange(value === 'true')}
                    >
                      <SelectTrigger id={`variable-${index}-default`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Activé</SelectItem>
                        <SelectItem value="false">Désactivé</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`variable-${index}-default`}
                      type={variable?.type === 'number' ? 'number' : 'text'}
                      value={String(defaultField.state.value)}
                      onChange={(e) =>
                        defaultField.handleChange(
                          variable?.type === 'number'
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                      onBlur={defaultField.handleBlur}
                    />
                  )}
                </FieldShell>
              )}
            </form.Field>

            <div className="md:col-span-2">
              <form.Field name={v.description}>
                {(descriptionField) => (
                  <FieldShell
                    id={`variable-${index}-description`}
                    label="Description"
                    errors={descriptionField.state.meta.errors}
                  >
                    <Textarea
                      id={`variable-${index}-description`}
                      rows={2}
                      value={descriptionField.state.value}
                      onChange={(e) => descriptionField.handleChange(e.target.value)}
                      onBlur={descriptionField.handleBlur}
                    />
                  </FieldShell>
                )}
              </form.Field>
            </div>

            {variable?.type === 'number' && (
              <>
                <form.Field name={v.min}>
                  {(minField) => (
                    <FieldShell
                      id={`variable-${index}-min`}
                      label="Minimum"
                      hint="0 = aucun"
                      errors={minField.state.meta.errors}
                    >
                      <Input
                        id={`variable-${index}-min`}
                        type="number"
                        value={String(minField.state.value)}
                        onChange={(e) => minField.handleChange(Number(e.target.value))}
                        onBlur={minField.handleBlur}
                      />
                    </FieldShell>
                  )}
                </form.Field>

                <form.Field name={v.max}>
                  {(maxField) => (
                    <FieldShell
                      id={`variable-${index}-max`}
                      label="Maximum"
                      hint="0 = aucun"
                      errors={maxField.state.meta.errors}
                    >
                      <Input
                        id={`variable-${index}-max`}
                        type="number"
                        value={String(maxField.state.value)}
                        onChange={(e) => maxField.handleChange(Number(e.target.value))}
                        onBlur={maxField.handleBlur}
                      />
                    </FieldShell>
                  )}
                </form.Field>
              </>
            )}

            {variable?.type === 'string' && (
              <form.Field name={v.pattern}>
                {(patternField) => (
                  <FieldShell
                    id={`variable-${index}-pattern`}
                    label="Pattern de validation (regex)"
                    hint="Équivalent des règles de validation Pelican."
                    errors={patternField.state.meta.errors}
                  >
                    <Input
                      id={`variable-${index}-pattern`}
                      className="font-mono"
                      value={patternField.state.value}
                      onChange={(e) => patternField.handleChange(e.target.value)}
                      onBlur={patternField.handleBlur}
                      placeholder="^[a-zA-Z0-9_.-]+$"
                    />
                  </FieldShell>
                )}
              </form.Field>
            )}

            <form.Field name={v.options}>
              {(optionsField) => (
                <FieldShell
                  id={`variable-${index}-options`}
                  label="Valeurs autorisées"
                  hint="Séparées par des virgules — vide = libre."
                  errors={optionsField.state.meta.errors}
                >
                  <TagsInput
                    id={`variable-${index}-options`}
                    value={optionsField.state.value}
                    onChange={optionsField.handleChange}
                    onBlur={optionsField.handleBlur}
                    placeholder="1.20.4, 1.21, latest"
                  />
                </FieldShell>
              )}
            </form.Field>

            <form.Field name={v.sort}>
              {(sortField) => (
                <FieldShell
                  id={`variable-${index}-sort`}
                  label="Ordre d'affichage"
                  errors={sortField.state.meta.errors}
                >
                  <Input
                    id={`variable-${index}-sort`}
                    type="number"
                    value={String(sortField.state.value)}
                    onChange={(e) => sortField.handleChange(Number(e.target.value))}
                    onBlur={sortField.handleBlur}
                  />
                </FieldShell>
              )}
            </form.Field>

            <div className="space-y-3 md:col-span-2">
              <p className="text-sm font-semibold">Permissions utilisateur</p>
              <div className="grid gap-3 md:grid-cols-3">
                <form.Field name={v.userViewable}>
                  {(viewableField) => (
                    <div className="flex items-center gap-3">
                      <Switch
                        id={`variable-${index}-viewable`}
                        checked={viewableField.state.value}
                        onCheckedChange={(checked) => viewableField.handleChange(checked)}
                      />
                      <Label htmlFor={`variable-${index}-viewable`}>
                        Visible par l'utilisateur
                      </Label>
                    </div>
                  )}
                </form.Field>

                <form.Field name={v.userEditable}>
                  {(editableField) => (
                    <div className="flex items-center gap-3">
                      <Switch
                        id={`variable-${index}-editable`}
                        checked={editableField.state.value}
                        onCheckedChange={(checked) => editableField.handleChange(checked)}
                      />
                      <Label htmlFor={`variable-${index}-editable`}>
                        Modifiable par l'utilisateur
                      </Label>
                    </div>
                  )}
                </form.Field>

                <form.Field name={v.required}>
                  {(requiredField) => (
                    <div className="flex items-center gap-3">
                      <Switch
                        id={`variable-${index}-required`}
                        checked={requiredField.state.value}
                        onCheckedChange={(checked) => requiredField.handleChange(checked)}
                      />
                      <Label htmlFor={`variable-${index}-required`}>Requise</Label>
                    </div>
                  )}
                </form.Field>
              </div>
            </div>
          </div>
        </CollapseCard>
      )}
    </form.Subscribe>
  );
}
