# KVR appointment finder
Have you ever found yourself in  the situation where you wanted to book an appointment at the KVR and no slot was available?

Well you could check the website every hour and hope that someone has canceled their appointment or you could automate that shit for you ;)

## How to use
### Configuration
Before searching for appointments you need to configure which type of appointment you are looking for. This is done in the `config.yaml`. You can simple copy/rename the `config-example.yaml` and adapt it for your needs

Additionally, you need to configure a Telegram bot that notifies you about the latest search results. First, you need to create a bot. This is done by sending the `BotFather` a message containing the command `/newbot`. It will then prompt you to enter a name and username for the bot. After that you will receive a token which you have to set in the `config.yaml`.

Secondly, you need your personal ChatID. This can be received by the `IDBot` first sending `/start` followed by the `/getid` command. Your ChatID has to be set in the `config.yaml` as well.

### Running the application
You can choose to either run the application in a docker container or directly on your system

#### Docker
Simply replace `your-config.yaml` with the name of your configuration file and run the commands below. 
```bash
docker build -t kvr .
docker run -v ./your-config.yaml:/app/config.yaml -it kvr
```

Note that non-Headless mode requires further configuration of the Dockerfile and your system.

#### System
```bash
yarn install
node index.js
```

### Known issues
It has recently been discovered that the dialogue is sometimes guarded by a (fairly simple) captcha. For now the program will simply skip the appointment search and wait for the configured interval.
