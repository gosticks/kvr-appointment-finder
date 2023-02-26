FROM mcr.microsoft.com/playwright:focal

WORKDIR /app
COPY . .

RUN yarn install --fronzen-lockfile

ENTRYPOINT [ "node", "index.js" ]