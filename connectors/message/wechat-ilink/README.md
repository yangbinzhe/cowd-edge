# WeChat iLink Message Connector

Builds to `cowd-edge-wechat-ilink-message`. It owns QR login, token persistence,
long-polling, and outbound iLink message delivery.

Gateway remains the routing and status boundary; Runtime never links this
connector or its SDK dependencies.
