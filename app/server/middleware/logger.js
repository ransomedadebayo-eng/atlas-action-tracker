export default function logger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(
      `${color}${req.method}\x1b[0m ${req.originalUrl} \x1b[90m${res.statusCode} ${duration}ms\x1b[0m`
    );
  });
  next();
}
