FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=pwuser:pwuser . .
USER pwuser
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]
