# WeChat iLink Surface

Builds to `cowd-surface-wechat-ilink`. It owns QR login, token persistence,
long-polling, and outbound iLink message delivery.

Gateway remains the routing and status boundary; Runtime never links this
surface or its SDK dependencies.
