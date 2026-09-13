// Checagem de papel, para usar depois do requireAuth.
//
// Sem isto /users fica protegido apenas por requireAuth, e qualquer usuário logado —
// inclusive uma recepcionista — pode chamar PUT /users/:id para se promover a admin ou
// trocar a senha do admin e assumir a conta.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
  };
}
