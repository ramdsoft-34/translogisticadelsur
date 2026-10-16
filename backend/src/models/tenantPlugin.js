// Aislamiento entre empresas (defensa en profundidad).
// Todo esquema con este plugin:
//   - exige el campo `empresa` al guardar (y no permite cambiarlo);
//   - rechaza cualquier consulta, actualización, borrado o agregación que no
//     filtre por `empresa`. Así, un olvido en una ruta produce un error en vez
//     de mezclar datos de varias empresas.
import mongoose from 'mongoose';

const OPS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'countDocuments', 'replaceOne', 'distinct'];

export class ErrorAislamiento extends Error {
  constructor(modelo) {
    super(`Consulta sin empresa sobre ${modelo || 'un modelo'}`);
    this.status = 500;
  }
}

export function tenantPlugin(schema) {
  schema.add({
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true, immutable: true },
  });

  for (const op of OPS) {
    schema.pre(op, function () {
      const q = this.getFilter();
      if (!q || q.empresa === undefined || q.empresa === null) throw new ErrorAislamiento(this.model?.modelName);
    });
  }
  schema.pre('aggregate', function () {
    const primera = this.pipeline()[0];
    if (!primera?.$match || primera.$match.empresa === undefined) throw new ErrorAislamiento(this._model?.modelName);
  });
}
