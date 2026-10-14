FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "node scripts/migrate.mjs && npx tsx src/index.ts"]
